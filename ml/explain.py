"""Integrated Gradients attribution for the churn network.

Why not SHAP: KernelSHAP on a Keras model costs thousands of forward passes
per row, which is far too slow for a synchronous API call. Integrated
Gradients is exact for this architecture, needs one batched forward/backward
pass over `steps` interpolations, and satisfies the same completeness axiom:
the attributions sum to f(x) - f(baseline).

The baseline is the training-set mean in transformed space, i.e. "the average
customer". An attribution therefore reads as: how much of this customer's
deviation from average risk is explained by this feature.
"""
from __future__ import annotations

import numpy as np
import tensorflow as tf


@tf.function(reduce_retracing=True)
def _grads(model, inputs):
    with tf.GradientTape() as tape:
        tape.watch(inputs)
        preds = model(inputs, training=False)
    return tape.gradient(preds, inputs)


def integrated_gradients(
    model,
    x: np.ndarray,
    baseline: np.ndarray,
    steps: int = 64,
) -> np.ndarray:
    """Attributions for a single transformed row `x` (shape: [n_features])."""
    x = np.asarray(x, dtype="float32").reshape(-1)
    baseline = np.asarray(baseline, dtype="float32").reshape(-1)

    # Riemann trapezoidal path from baseline to x.
    alphas = np.linspace(0.0, 1.0, steps, dtype="float32").reshape(-1, 1)
    path = baseline.reshape(1, -1) + alphas * (x - baseline).reshape(1, -1)

    grads = _grads(model, tf.convert_to_tensor(path)).numpy()
    avg_grads = (grads[:-1] + grads[1:]) / 2.0
    avg_grad = avg_grads.mean(axis=0)

    return (x - baseline) * avg_grad


def aggregate_by_source(
    attributions: np.ndarray,
    feature_names: list[str],
    source_map: dict[str, str],
) -> dict[str, float]:
    """Collapse one-hot dummies back onto their original column."""
    totals: dict[str, float] = {}
    for value, name in zip(attributions, feature_names):
        key = source_map.get(name, name)
        totals[key] = totals.get(key, 0.0) + float(value)
    return totals


def permutation_importance(
    model,
    X: np.ndarray,
    y: np.ndarray,
    feature_names: list[str],
    source_map: dict[str, str],
    n_repeats: int = 5,
    seed: int = 42,
) -> list[dict]:
    """Global importance: drop in ROC-AUC when a feature group is shuffled.

    Dummies belonging to the same source column are permuted together, so the
    score reflects the real column rather than one arbitrary level of it.
    """
    from sklearn.metrics import roc_auc_score

    rng = np.random.default_rng(seed)
    base = roc_auc_score(y, model.predict(X, verbose=0).ravel())

    groups: dict[str, list[int]] = {}
    for idx, name in enumerate(feature_names):
        groups.setdefault(source_map.get(name, name), []).append(idx)

    results = []
    for source, idxs in groups.items():
        drops = []
        for _ in range(n_repeats):
            Xp = X.copy()
            order = rng.permutation(len(Xp))
            Xp[:, idxs] = Xp[order][:, idxs]
            drops.append(base - roc_auc_score(y, model.predict(Xp, verbose=0).ravel()))
        results.append(
            {
                "feature": source,
                "importance": float(np.mean(drops)),
                "std": float(np.std(drops)),
            }
        )

    results.sort(key=lambda r: r["importance"], reverse=True)
    return results
