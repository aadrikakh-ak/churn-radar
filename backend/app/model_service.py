"""Loads the trained artifacts once and serves predictions.

Everything stateful lives here so the route handlers stay thin and the model
is loaded exactly once per process, not once per request.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from . import config as cfg
from .labels import FEATURE_NOTES, UNITS, label_for, risk_band

# The feature engineering is imported from the training package rather than
# re-implemented. Train/serve skew is the classic way a model that scored 0.84
# offline quietly returns garbage in production.
sys.path.insert(0, str(cfg.PROJECT_ROOT))
from ml.calibration import apply_platt  # noqa: E402
from ml.data import clean, engineer_features, feature_columns  # noqa: E402
from ml.explain import aggregate_by_source, integrated_gradients  # noqa: E402

RETENTION_PLAYBOOK = {
    "Contract": "Offer a discounted 12-month contract — contract length is the strongest lever in the model.",
    "ContractMonths": "Offer a discounted 12-month contract — contract length is the strongest lever in the model.",
    "TechSupport": "Bundle tech support free for 6 months; unsupported fibre customers churn hardest.",
    "OnlineSecurity": "Include online security at no cost for the first year.",
    "PaymentMethod": "Move the customer to auto-pay (card or bank transfer) with a small bill credit.",
    "InternetService": "Review the fibre plan — check for recent outages or a speed/price mismatch.",
    "MonthlyCharges": "Run a price review; the bill sits above what comparable customers pay.",
    "ChargesDelta": "A recent bill increase is driving risk — consider grandfathering the old rate.",
    "tenure": "Early-life customer: trigger the 90-day onboarding journey and a check-in call.",
    "TenureBucket": "Early-life customer: trigger the 90-day onboarding journey and a check-in call.",
    "TenureYears": "Early-life customer: trigger the 90-day onboarding journey and a check-in call.",
    "PaperlessBilling": "Confirm billing contact details are current and bills are actually being received.",
    "NumServices": "Low service adoption — pitch a bundle that raises stickiness.",
    "MonthlyChargeRatio": "Bill has risen sharply versus this customer's own history; review the increase.",
}

# Interventions the business can actually make, used by /what-if.
INTERVENTIONS = [
    ("Move to a 1-year contract", {"Contract": "One year"}),
    ("Move to a 2-year contract", {"Contract": "Two year"}),
    ("Add tech support", {"TechSupport": "Yes"}),
    ("Add online security", {"OnlineSecurity": "Yes"}),
    ("Switch to automatic card payment", {"PaymentMethod": "Credit card (automatic)"}),
    ("Cut the monthly bill by 15%", {"__scale_monthly__": 0.85}),
]


def _format_value(feature: str, raw_value) -> str:
    """Render a feature value the way a person would write it."""
    if not isinstance(raw_value, (int, float, np.integer, np.floating)):
        return str(raw_value)

    number = float(raw_value)
    unit = UNITS.get(feature)
    if unit is None:
        return f"{number:.2f}".rstrip("0").rstrip(".")
    if unit.startswith("$"):
        suffix = "/mo" if "/mo" in unit else ""
        return f"${number:,.2f}{suffix}"
    trimmed = f"{number:.2f}".rstrip("0").rstrip(".")
    noun = unit[:-1] if (unit.endswith("s") and number == 1) else unit
    return f"{trimmed} {noun}"


class ModelService:
    def __init__(self) -> None:
        self.ready = False
        self.error: str | None = None
        self.model = None
        self.preprocessor = None
        self.metadata: dict = {}
        self.metrics: dict = {}
        self.baseline: np.ndarray | None = None
        self.baseline_probability: float = 0.0
        self.loaded_at: float | None = None

    # ------------------------------------------------------------------ load
    def load(self) -> None:
        start = time.time()
        try:
            import tensorflow as tf

            missing = [
                p.name
                for p in (cfg.MODEL_PATH, cfg.PREPROCESSOR_PATH, cfg.METADATA_PATH)
                if not Path(p).exists()
            ]
            if missing:
                raise FileNotFoundError(
                    f"missing artifact(s): {', '.join(missing)}. Run `python -m ml.train` first."
                )

            self.model = tf.keras.models.load_model(cfg.MODEL_PATH, compile=False)
            self.preprocessor = joblib.load(cfg.PREPROCESSOR_PATH)
            self.metadata = json.loads(Path(cfg.METADATA_PATH).read_text())
            if Path(cfg.METRICS_PATH).exists():
                self.metrics = json.loads(Path(cfg.METRICS_PATH).read_text())

            self.baseline = np.asarray(self.metadata["baseline_vector"], dtype="float32")
            self._calib = self.metadata.get("calibration", {"a": 1.0, "b": 0.0})

            # Warm both graphs: the first call pays TensorFlow's tracing cost,
            # and we would rather pay it at boot than on a user's first click.
            warm = self.baseline.reshape(1, -1)
            raw = float(self.model.predict(warm, verbose=0).ravel()[0])
            self.baseline_probability = self._calibrate(raw)
            integrated_gradients(self.model, self.baseline, self.baseline, steps=8)

            self.ready = True
            self.error = None
            self.loaded_at = time.time()
            print(f"[model] ready in {time.time() - start:.1f}s "
                  f"({self.metadata.get('n_parameters', 0):,} params, "
                  f"ensemble of {self.metadata.get('ensemble_size', 1)})")
        except Exception as exc:  # pragma: no cover - surfaced via /health
            self.error = f"{type(exc).__name__}: {exc}"
            self.ready = False
            print(f"[model] FAILED to load: {self.error}")

    def _require(self) -> None:
        if not self.ready:
            raise RuntimeError(self.error or "model is not loaded")

    def _calibrate(self, raw: float | np.ndarray):
        return apply_platt(np.atleast_1d(raw), self._calib["a"], self._calib["b"])[0] \
            if np.isscalar(raw) or np.ndim(raw) == 0 \
            else apply_platt(raw, self._calib["a"], self._calib["b"])

    # -------------------------------------------------------------- transform
    def _to_matrix(self, rows: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
        engineered = engineer_features(clean(rows))
        numeric, categorical = feature_columns()
        ordered = engineered[numeric + categorical]
        return self.preprocessor.transform(ordered).astype("float32"), engineered

    # ---------------------------------------------------------------- predict
    def threshold_for(self, policy: str = "default", override: float | None = None) -> float:
        if override is not None:
            return float(override)
        return float(self.metadata["thresholds"].get(policy, self.metadata["thresholds"]["default"]))

    def predict_one(
        self,
        customer: dict,
        policy: str = "default",
        override: float | None = None,
        explain: bool = True,
    ) -> dict:
        self._require()
        t0 = time.perf_counter()

        X, engineered = self._to_matrix(pd.DataFrame([customer]))
        raw = float(self.model.predict(X, verbose=0).ravel()[0])
        prob = float(self._calibrate(raw))
        threshold = self.threshold_for(policy, override)

        drivers = self._explain(X[0], engineered.iloc[0]) if explain else []

        monthly = float(customer.get("MonthlyCharges", 0.0))
        return {
            "churn_probability": prob,
            "raw_probability": raw,
            "will_churn": prob >= threshold,
            "risk_band": risk_band(prob),
            "threshold": threshold,
            "threshold_policy": "custom" if override is not None else policy,
            # How far from the boundary, rescaled to 0-1. A prediction sitting
            # on the threshold is a coin flip and the UI should say so.
            "confidence": float(min(1.0, abs(prob - threshold) / max(threshold, 1 - threshold))),
            "drivers": drivers,
            "baseline_probability": self.baseline_probability,
            "expected_revenue_at_risk": round(monthly * 12 * prob, 2),
            "recommended_actions": self._actions(drivers, prob, threshold),
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
        }

    def _explain(self, x: np.ndarray, engineered_row: pd.Series) -> list[dict]:
        attributions = integrated_gradients(self.model, x, self.baseline, steps=cfg.IG_STEPS)
        totals = aggregate_by_source(
            attributions, self.metadata["feature_names"], self.metadata["source_map"]
        )

        ranked = sorted(totals.items(), key=lambda kv: abs(kv[1]), reverse=True)
        drivers = []
        for feature, contribution in ranked[: cfg.TOP_DRIVERS]:
            if abs(contribution) < 1e-5:
                continue
            raw_value = engineered_row.get(feature, "")
            value = _format_value(feature, raw_value)
            drivers.append(
                {
                    "feature": feature,
                    "label": label_for(feature),
                    "value": value,
                    "contribution": round(float(contribution), 5),
                    "direction": "increases" if contribution > 0 else "decreases",
                }
            )
        return drivers

    def _actions(self, drivers: list[dict], prob: float, threshold: float) -> list[str]:
        if prob < threshold:
            return ["No intervention needed — keep this customer in routine lifecycle marketing."]
        actions, seen = [], set()
        for d in drivers:
            if d["direction"] != "increases":
                continue
            tip = RETENTION_PLAYBOOK.get(d["feature"])
            if tip and tip not in seen:
                seen.add(tip)
                actions.append(tip)
            if len(actions) == 3:
                break
        if not actions:
            actions.append("Flagged as at-risk; route to the retention team for a manual review.")
        return actions

    # ------------------------------------------------------------------ batch
    def predict_batch(
        self,
        frame: pd.DataFrame,
        policy: str = "default",
        override: float | None = None,
        explain: bool = False,
    ) -> dict:
        self._require()
        t0 = time.perf_counter()

        ids = None
        if "customerID" in frame.columns:
            ids = frame["customerID"].astype(str).tolist()

        X, engineered = self._to_matrix(frame)
        # One vectorised forward pass for the whole file rather than a Python
        # loop: 7k rows score in well under a second.
        raw = self.model.predict(X, batch_size=512, verbose=0).ravel()
        probs = self._calibrate(raw)
        threshold = self.threshold_for(policy, override)

        monthly = pd.to_numeric(frame.get("MonthlyCharges", 0), errors="coerce").fillna(0).values

        results = []
        for i, (p, r) in enumerate(zip(probs, raw)):
            p = float(p)
            results.append(
                {
                    "row": i,
                    "customer_id": ids[i] if ids else None,
                    "churn_probability": p,
                    "raw_probability": float(r),
                    "will_churn": bool(p >= threshold),
                    "risk_band": risk_band(p),
                    "threshold": threshold,
                    "threshold_policy": "custom" if override is not None else policy,
                    "confidence": float(
                        min(1.0, abs(p - threshold) / max(threshold, 1 - threshold))
                    ),
                    "drivers": self._explain(X[i], engineered.iloc[i]) if explain else [],
                    "baseline_probability": self.baseline_probability,
                    "expected_revenue_at_risk": round(float(monthly[i]) * 12 * p, 2),
                    "recommended_actions": [],
                    "latency_ms": 0.0,
                }
            )

        flagged = int((probs >= threshold).sum())
        return {
            "count": len(results),
            "flagged": flagged,
            "mean_probability": float(np.mean(probs)) if len(probs) else 0.0,
            "total_revenue_at_risk": round(float(np.sum(monthly * probs * 12)), 2),
            "threshold": threshold,
            "results": results,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
        }

    # ----------------------------------------------------------------- whatif
    def what_if(self, customer: dict, policy: str = "default") -> dict:
        """Re-score the customer under each retention offer.

        This is the part a business audience cares about: not "this customer
        is 81% likely to leave" but "a 12-month contract takes that to 34%".
        """
        self._require()
        base = self.predict_one(customer, policy=policy, explain=False)
        current = base["churn_probability"]
        monthly = float(customer.get("MonthlyCharges", 0.0))

        variants, labels = [], []
        for label, change in INTERVENTIONS:
            candidate = dict(customer)
            if "__scale_monthly__" in change:
                factor = change["__scale_monthly__"]
                candidate["MonthlyCharges"] = round(monthly * factor, 2)
                desc = f"MonthlyCharges {monthly:.2f} -> {candidate['MonthlyCharges']:.2f}"
            else:
                for k, v in change.items():
                    candidate[k] = v
                desc = ", ".join(f"{k} -> {v}" for k, v in change.items())
            variants.append(candidate)
            labels.append((label, desc))

        X, _ = self._to_matrix(pd.DataFrame(variants))
        raw = self.model.predict(X, verbose=0).ravel()
        probs = self._calibrate(raw)

        scenarios = []
        for (label, desc), p in zip(labels, probs):
            p = float(p)
            scenarios.append(
                {
                    "label": label,
                    "change": desc,
                    "churn_probability": p,
                    "delta": round(p - current, 5),
                    "revenue_saved": round(max(0.0, current - p) * monthly * 12, 2),
                }
            )
        scenarios.sort(key=lambda s: s["delta"])
        return {"current": current, "scenarios": scenarios}

    # ------------------------------------------------------------------ meta
    def info(self) -> dict:
        md = self.metadata
        return {
            "status": "ready" if self.ready else "error",
            "error": self.error,
            "model": {
                "type": "Feed-forward ANN (Keras) — averaged seed ensemble",
                "architecture": md.get("architecture"),
                "dropout": md.get("dropout"),
                "ensemble_size": md.get("ensemble_size"),
                "inputs": md.get("n_inputs"),
                "parameters": md.get("n_parameters"),
                "epochs_run": md.get("epochs_run"),
                "trained_at": md.get("trained_at"),
                "train_seconds": md.get("train_seconds"),
                "calibration": md.get("calibration", {}).get("method", "none"),
            },
            "thresholds": md.get("thresholds", {}),
            "rows": md.get("rows"),
            "explainer": {
                "method": "Integrated Gradients",
                "steps": cfg.IG_STEPS,
                "baseline": "training-set mean (the average customer)",
            },
            "feature_notes": FEATURE_NOTES,
        }


service = ModelService()
