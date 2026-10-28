"""Platt scaling, stored as two floats so serving needs no pickled object."""
from __future__ import annotations

import numpy as np

EPS = 1e-6


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype="float64"), EPS, 1 - EPS)
    return np.log(p / (1 - p))


def fit_platt(probs: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Fit calibrated = sigmoid(a * logit(raw) + b) on a held-out split."""
    from sklearn.linear_model import LogisticRegression

    lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000)
    lr.fit(_logit(probs).reshape(-1, 1), np.asarray(y).astype(int))
    return float(lr.coef_[0][0]), float(lr.intercept_[0])


def apply_platt(probs: np.ndarray, a: float, b: float) -> np.ndarray:
    """Monotonic in `probs` for a > 0, so the ranking is preserved exactly."""
    z = a * _logit(probs) + b
    return (1.0 / (1.0 + np.exp(-z))).astype("float64")
