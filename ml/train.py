"""Train the churn ANN end to end and write every serving artifact.

    python -m ml.train

Outputs land in ./artifacts and are the only thing the backend needs.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight

from . import config as C
from .calibration import apply_platt, fit_platt
from .data import feature_columns, prepare
from .explain import permutation_importance
from .model import build_ann, callbacks, combine_ensemble as build_ann_ensemble
from .preprocess import build_preprocessor, source_feature_map, transformed_feature_names


def _split(X, y):
    X_tr, X_tmp, y_tr, y_tmp = train_test_split(
        X, y, test_size=C.TEST_SIZE + C.VAL_SIZE, stratify=y, random_state=C.RANDOM_SEED
    )
    rel = C.TEST_SIZE / (C.TEST_SIZE + C.VAL_SIZE)
    X_val, X_te, y_val, y_te = train_test_split(
        X_tmp, y_tmp, test_size=rel, stratify=y_tmp, random_state=C.RANDOM_SEED
    )
    return X_tr, X_val, X_te, y_tr, y_val, y_te


def tune_thresholds(y_true, probs) -> dict:
    """Pick operating points that are actually defensible in a viva.

    - f1: best balance of precision and recall
    - cost: minimises COST_FN * FN + COST_FP * FP, the business objective
    - recall_80: cheapest threshold that still catches 80% of churners
    """
    grid = np.linspace(0.05, 0.95, 181)
    rows = []
    for t in grid:
        pred = (probs >= t).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
        rows.append(
            {
                "threshold": float(t),
                "f1": f1_score(y_true, pred, zero_division=0),
                "precision": precision_score(y_true, pred, zero_division=0),
                "recall": recall_score(y_true, pred, zero_division=0),
                "cost": float(C.COST_FALSE_NEGATIVE * fn + C.COST_FALSE_POSITIVE * fp),
            }
        )

    best_f1 = max(rows, key=lambda r: r["f1"])
    best_cost = min(rows, key=lambda r: r["cost"])
    recall_rows = [r for r in rows if r["recall"] >= 0.80]
    best_recall = max(recall_rows, key=lambda r: r["precision"]) if recall_rows else best_f1

    return {
        "default": round(best_f1["threshold"], 4),
        "f1_optimal": round(best_f1["threshold"], 4),
        "cost_optimal": round(best_cost["threshold"], 4),
        "high_recall": round(best_recall["threshold"], 4),
        "sweep": [
            {k: round(v, 5) for k, v in r.items()} for r in rows[::4]
        ],
    }


def evaluate(y_true, probs, threshold) -> dict:
    pred = (probs >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "threshold": float(threshold),
        "accuracy": float(accuracy_score(y_true, pred)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, probs)),
        "pr_auc": float(average_precision_score(y_true, probs)),
        "brier": float(brier_score_loss(y_true, probs)),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def curve_points(y_true, probs, n=120) -> dict:
    fpr, tpr, _ = roc_curve(y_true, probs)
    prec, rec, _ = precision_recall_curve(y_true, probs)
    idx_r = np.linspace(0, len(fpr) - 1, min(n, len(fpr))).astype(int)
    idx_p = np.linspace(0, len(prec) - 1, min(n, len(prec))).astype(int)

    # Reliability curve in 10 equal-width probability bins.
    bins = np.linspace(0, 1, 11)
    which = np.digitize(probs, bins) - 1
    calib = []
    for b in range(10):
        mask = which == b
        if mask.sum() >= 5:
            calib.append(
                {
                    "predicted": float(probs[mask].mean()),
                    "observed": float(np.asarray(y_true)[mask].mean()),
                    "count": int(mask.sum()),
                }
            )

    return {
        "roc": [{"fpr": float(fpr[i]), "tpr": float(tpr[i])} for i in idx_r],
        "pr": [{"recall": float(rec[i]), "precision": float(prec[i])} for i in idx_p],
        "calibration": calib,
    }


def lift_table(y_true, probs, deciles=10) -> list[dict]:
    """Classic decile lift — the table a retention team actually uses."""
    df = pd.DataFrame({"y": np.asarray(y_true), "p": probs}).sort_values("p", ascending=False)
    df["decile"] = pd.qcut(df["p"].rank(method="first", ascending=False), deciles, labels=False) + 1
    base = df["y"].mean()
    out = []
    cum_churn = 0
    total_churn = df["y"].sum()
    for d, grp in df.groupby("decile"):
        cum_churn += grp["y"].sum()
        out.append(
            {
                "decile": int(d),
                "customers": int(len(grp)),
                "churners": int(grp["y"].sum()),
                "churn_rate": float(grp["y"].mean()),
                "lift": float(grp["y"].mean() / base) if base else 0.0,
                "cumulative_capture": float(cum_churn / total_churn) if total_churn else 0.0,
            }
        )
    return out


def baselines(Xt_tr, y_tr, Xt_te, y_te) -> list[dict]:
    """Classical models for the comparison table in the report."""
    out = []
    for name, clf in [
        ("Logistic Regression", LogisticRegression(max_iter=2000, class_weight="balanced")),
        (
            "Random Forest",
            RandomForestClassifier(
                n_estimators=400,
                min_samples_leaf=5,
                class_weight="balanced",
                random_state=C.RANDOM_SEED,
                n_jobs=-1,
            ),
        ),
    ]:
        clf.fit(Xt_tr, y_tr)
        p = clf.predict_proba(Xt_te)[:, 1]
        pred = (p >= 0.5).astype(int)
        out.append(
            {
                "model": name,
                "roc_auc": float(roc_auc_score(y_te, p)),
                "pr_auc": float(average_precision_score(y_te, p)),
                "f1": float(f1_score(y_te, pred, zero_division=0)),
                "accuracy": float(accuracy_score(y_te, pred)),
            }
        )
    return out


def save_plots(history, y_te, probs_te, metrics, importance):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    C.PLOTS.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"figure.dpi": 140, "font.size": 9, "axes.grid": True,
                         "grid.alpha": 0.25, "axes.spines.top": False, "axes.spines.right": False})
    ink, accent = "#0f172a", "#6366f1"

    # 1 — learning curves
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.4))
    for ax, key, title in [
        (axes[0], "loss", "Binary cross-entropy"),
        (axes[1], "auc", "ROC-AUC"),
        (axes[2], "pr_auc", "PR-AUC"),
    ]:
        ax.plot(history[key], color=accent, label="train", lw=1.6)
        ax.plot(history["val_" + key], color="#f97316", label="validation", lw=1.6)
        ax.set_title(title)
        ax.set_xlabel("epoch")
        ax.legend(frameon=False)
    fig.suptitle("Training history", color=ink, fontweight="bold")
    fig.tight_layout()
    fig.savefig(C.PLOTS / "training_history.png", bbox_inches="tight")
    plt.close(fig)

    # 2 — ROC + PR + calibration
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6))
    fpr, tpr, _ = roc_curve(y_te, probs_te)
    axes[0].plot(fpr, tpr, color=accent, lw=2)
    axes[0].plot([0, 1], [0, 1], "--", color="#94a3b8", lw=1)
    axes[0].set_title(f"ROC (AUC = {metrics['roc_auc']:.3f})")
    axes[0].set_xlabel("false positive rate")
    axes[0].set_ylabel("true positive rate")

    prec, rec, _ = precision_recall_curve(y_te, probs_te)
    axes[1].plot(rec, prec, color="#059669", lw=2)
    axes[1].axhline(np.mean(y_te), ls="--", color="#94a3b8", lw=1)
    axes[1].set_title(f"Precision-Recall (AP = {metrics['pr_auc']:.3f})")
    axes[1].set_xlabel("recall")
    axes[1].set_ylabel("precision")

    bins = np.linspace(0, 1, 11)
    which = np.digitize(probs_te, bins) - 1
    xs, ys = [], []
    for b in range(10):
        m = which == b
        if m.sum() >= 5:
            xs.append(probs_te[m].mean())
            ys.append(np.asarray(y_te)[m].mean())
    axes[2].plot([0, 1], [0, 1], "--", color="#94a3b8", lw=1)
    axes[2].plot(xs, ys, "o-", color="#db2777", lw=2, ms=4)
    axes[2].set_title(f"Calibration (Brier = {metrics['brier']:.3f})")
    axes[2].set_xlabel("predicted probability")
    axes[2].set_ylabel("observed churn rate")
    fig.tight_layout()
    fig.savefig(C.PLOTS / "evaluation_curves.png", bbox_inches="tight")
    plt.close(fig)

    # 3 — confusion matrix
    cm = metrics["confusion_matrix"]
    arr = np.array([[cm["tn"], cm["fp"]], [cm["fn"], cm["tp"]]])
    fig, ax = plt.subplots(figsize=(4, 3.6))
    ax.imshow(arr, cmap="Purples")
    ax.grid(False)
    for (i, j), v in np.ndenumerate(arr):
        ax.text(j, i, f"{v}", ha="center", va="center",
                color="white" if v > arr.max() / 2 else ink, fontweight="bold")
    ax.set_xticks([0, 1], ["pred: stay", "pred: churn"])
    ax.set_yticks([0, 1], ["actual: stay", "actual: churn"])
    ax.set_title(f"Confusion matrix @ {metrics['threshold']:.2f}")
    fig.tight_layout()
    fig.savefig(C.PLOTS / "confusion_matrix.png", bbox_inches="tight")
    plt.close(fig)

    # 4 — permutation importance
    top = importance[:14][::-1]
    fig, ax = plt.subplots(figsize=(6.5, 5))
    ax.barh([r["feature"] for r in top], [r["importance"] for r in top],
            xerr=[r["std"] for r in top], color=accent, alpha=0.85)
    ax.set_xlabel("drop in ROC-AUC when shuffled")
    ax.set_title("Global feature importance")
    fig.tight_layout()
    fig.savefig(C.PLOTS / "feature_importance.png", bbox_inches="tight")
    plt.close(fig)


def main():
    started = time.time()
    C.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    C.PLOTS.mkdir(parents=True, exist_ok=True)

    print("1/7  loading + engineering features")
    X, y = prepare()
    print(f"     {X.shape[0]} rows, {X.shape[1]} engineered columns, "
          f"churn rate {y.mean():.1%}")

    X_tr, X_val, X_te, y_tr, y_val, y_te = _split(X, y)
    print(f"     split  train={len(X_tr)}  val={len(X_val)}  test={len(X_te)}")

    print("2/7  fitting preprocessor")
    pre = build_preprocessor()
    Xt_tr = pre.fit_transform(X_tr).astype("float32")
    Xt_val = pre.transform(X_val).astype("float32")
    Xt_te = pre.transform(X_te).astype("float32")
    names = transformed_feature_names(pre)
    smap = source_feature_map(pre)
    print(f"     {Xt_tr.shape[1]} model inputs after one-hot encoding")

    print(f"3/7  training {C.ENSEMBLE_SIZE} seeded network(s)")
    weights = compute_class_weight("balanced", classes=np.array([0, 1]), y=y_tr.values)
    class_weight = {0: float(weights[0]), 1: float(weights[1])}

    members, histories, member_scores = [], [], []
    for k, seed in enumerate(C.ENSEMBLE_SEEDS[: C.ENSEMBLE_SIZE], start=1):
        net = build_ann(Xt_tr.shape[1], seed=seed, prefix=f"m{k}_")
        if k == 1:
            net.summary()
        h = net.fit(
            Xt_tr,
            y_tr.values,
            validation_data=(Xt_val, y_val.values),
            epochs=C.EPOCHS,
            batch_size=C.BATCH_SIZE,
            class_weight=class_weight,
            callbacks=callbacks(C.ARTIFACTS / f"checkpoint_m{k}.keras"),
            verbose=0,
        )
        net.trainable = False
        members.append(net)
        histories.append(h.history)
        auc_k = roc_auc_score(y_val.values, net.predict(Xt_val, verbose=0).ravel())
        member_scores.append(float(auc_k))
        print(f"     member {k} (seed {seed}): {len(h.history['loss'])} epochs, "
              f"val ROC-AUC {auc_k:.4f}")

    model = build_ann_ensemble(members, Xt_tr.shape[1])
    ens_auc = roc_auc_score(y_val.values, model.predict(Xt_val, verbose=0).ravel())
    print(f"     ensemble of {len(members)}: val ROC-AUC {ens_auc:.4f} "
          f"(best single {max(member_scores):.4f})")

    # Report the first member's curves; all members share the recipe.
    hist = type("H", (), {"history": histories[0]})()

    print("4/7  calibrating probabilities + tuning decision threshold")
    raw_val = model.predict(Xt_val, verbose=0).ravel()

    # Class weighting makes the network deliberately over-predict churn, so
    # its raw sigmoid ranks well but is a poor *probability* — the UI would
    # show "73% risk" for a customer who churns 55% of the time.
    #
    # Platt scaling (a logistic fit on the log-odds) is used rather than
    # isotonic: it is strictly monotonic, so ROC-AUC and PR-AUC are
    # mathematically unchanged and only the scale moves. Isotonic was tried
    # first and cost 0.03 PR-AUC by tying scores together inside its steps.
    # Two floats are stored instead of a pickled object, so serving needs no
    # sklearn class to unpickle against.
    calib_a, calib_b = fit_platt(raw_val, y_val.values)
    probs_val = apply_platt(raw_val, calib_a, calib_b)

    brier_before = float(brier_score_loss(y_val.values, raw_val))
    brier_after = float(brier_score_loss(y_val.values, probs_val))
    print(f"     Brier score {brier_before:.4f} -> {brier_after:.4f} after Platt scaling "
          f"(a={calib_a:.3f}, b={calib_b:.3f})")

    thresholds = tune_thresholds(y_val.values, probs_val)
    print(f"     f1-optimal={thresholds['f1_optimal']}  "
          f"cost-optimal={thresholds['cost_optimal']}  "
          f"high-recall={thresholds['high_recall']}")

    print("5/7  evaluating on held-out test set")
    raw_te = model.predict(Xt_te, verbose=0).ravel()
    probs_te = apply_platt(raw_te, calib_a, calib_b)
    test_metrics = evaluate(y_te.values, probs_te, thresholds["default"])
    at_half = evaluate(y_te.values, probs_te, 0.5)
    print(f"     ROC-AUC={test_metrics['roc_auc']:.4f}  PR-AUC={test_metrics['pr_auc']:.4f}  "
          f"F1={test_metrics['f1']:.4f}  recall={test_metrics['recall']:.4f}")

    print("6/7  importance, baselines, curves")
    importance = permutation_importance(model, Xt_te, y_te.values, names, smap, n_repeats=5)
    base_models = baselines(Xt_tr, y_tr.values, Xt_te, y_te.values)
    curves = curve_points(y_te.values, probs_te)
    lift = lift_table(y_te.values, probs_te)

    history = {k: [float(v) for v in vals] for k, vals in hist.history.items()}
    save_plots(history, y_te.values, probs_te, test_metrics, importance)

    print("7/7  writing artifacts")
    # Inference-only: dropping the optimizer state halves the file and stops
    # Keras warning about mismatched slots every time the API boots.
    model.save(C.ARTIFACTS / "model.keras", include_optimizer=False)
    joblib.dump(pre, C.ARTIFACTS / "preprocessor.joblib")

    numeric, categorical = feature_columns()
    raw_df = X  # engineered but untransformed, for UI ranges and dropdowns
    schema = {
        "numeric": {
            col: {
                "min": float(raw_df[col].min()),
                "max": float(raw_df[col].max()),
                "mean": float(raw_df[col].mean()),
                "median": float(raw_df[col].median()),
            }
            for col in numeric
        },
        "categorical": {
            col: sorted(raw_df[col].astype(str).unique().tolist()) for col in categorical
        },
        "user_inputs": C.NUMERIC_RAW + C.BINARY_RAW + C.MULTI_RAW,
        "derived": C.ENGINEERED_NUMERIC + C.ENGINEERED_CATEGORICAL,
    }

    metadata = {
        "feature_names": names,
        "source_map": smap,
        "baseline_vector": Xt_tr.mean(axis=0).astype(float).tolist(),
        "thresholds": thresholds,
        "calibration": {"method": "platt", "a": calib_a, "b": calib_b},
        "class_weight": class_weight,
        "architecture": C.ARCHITECTURE,
        "dropout": C.DROPOUT,
        "ensemble_size": len(members),
        "member_val_roc_auc": member_scores,
        "ensemble_val_roc_auc": float(ens_auc),
        "n_inputs": int(Xt_tr.shape[1]),
        "n_parameters": int(model.count_params()),
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "epochs_run": len(history["loss"]),
        "train_seconds": round(time.time() - started, 1),
        "rows": {"train": len(X_tr), "validation": len(X_val), "test": len(X_te)},
        "schema": schema,
    }

    metrics = {
        "test": test_metrics,
        "test_at_0.5": at_half,
        "calibration_effect": {
            "brier_before": brier_before,
            "brier_after": brier_after,
            "method": "Platt scaling fitted on the validation split",
            "a": calib_a,
            "b": calib_b,
        },
        "validation": evaluate(y_val.values, probs_val, thresholds["default"]),
        "thresholds": thresholds,
        "curves": curves,
        "lift": lift,
        "importance": importance,
        "baselines": base_models,
        "history": history,
        "dataset": {
            "rows": int(len(X)),
            "features_raw": len(C.NUMERIC_RAW + C.BINARY_RAW + C.MULTI_RAW),
            "features_engineered": len(C.ENGINEERED_NUMERIC + C.ENGINEERED_CATEGORICAL),
            "churn_rate": float(y.mean()),
        },
        "trained_at": metadata["trained_at"],
    }

    (C.ARTIFACTS / "metadata.json").write_text(json.dumps(metadata, indent=2))
    (C.ARTIFACTS / "metrics.json").write_text(json.dumps(metrics, indent=2))
    for ck in C.ARTIFACTS.glob("checkpoint_m*.keras"):
        ck.unlink(missing_ok=True)

    print(f"\ndone in {time.time() - started:.1f}s -> {C.ARTIFACTS}")
    print(f"  ANN ensemble       ROC-AUC {test_metrics['roc_auc']:.4f}   "
          f"F1 {test_metrics['f1']:.4f}")
    for b in base_models:
        print(f"  {b['model']:<18} ROC-AUC {b['roc_auc']:.4f}   F1 {b['f1']:.4f}")


if __name__ == "__main__":
    main()
