"""Loading, cleaning and feature engineering for the Telco churn dataset.

The exact same `engineer_features` function is imported by the FastAPI backend
so that a row scored in production goes through byte-identical logic to a row
seen during training. That is the single most common source of silent model
decay, so it lives in one place only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C


def load_raw(path=None) -> pd.DataFrame:
    df = pd.read_csv(path or C.DATA_RAW)
    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Fix the known defects in the Kaggle file."""
    df = df.copy()

    # `TotalCharges` ships as an object column: 11 rows carry a blank string
    # because those customers joined this month (tenure == 0).
    if not pd.api.types.is_numeric_dtype(df["TotalCharges"]):
        df["TotalCharges"] = pd.to_numeric(
            df["TotalCharges"].astype(str).str.strip().replace("", None),
            errors="coerce",
        )
    df["TotalCharges"] = df["TotalCharges"].astype(float).fillna(0.0)
    df["MonthlyCharges"] = pd.to_numeric(df["MonthlyCharges"], errors="coerce").fillna(0.0)
    df["tenure"] = pd.to_numeric(df["tenure"], errors="coerce").fillna(0).astype(int)

    df["SeniorCitizen"] = df["SeniorCitizen"].astype(int)

    if C.ID_COL in df.columns:
        df = df.drop(columns=[C.ID_COL])

    if C.TARGET in df.columns:
        df[C.TARGET] = (
            df[C.TARGET].astype(str).str.strip().str.lower().map({"yes": 1, "no": 0})
        )

    # Normalise the "No internet service" / "No phone service" family so the
    # encoder does not learn three categories where two carry the signal.
    for col in C.MULTI_RAW:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()

    return df


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Derive the domain features. Pure, stateless, train/serve identical."""
    df = df.copy()

    tenure = df["tenure"].astype(float)
    monthly = df["MonthlyCharges"].astype(float)
    total = df["TotalCharges"].astype(float)

    safe_tenure = tenure.replace(0, np.nan)

    # Realised average bill. Diverges from MonthlyCharges when the customer
    # has up/downgraded, which is itself a churn signal.
    df["AvgChargesPerMonth"] = (total / safe_tenure).fillna(monthly)

    # Positive => currently paying more than their historical average.
    df["ChargesDelta"] = monthly - df["AvgChargesPerMonth"]

    df["MonthlyChargeRatio"] = monthly / df["AvgChargesPerMonth"].replace(0, np.nan)
    df["MonthlyChargeRatio"] = df["MonthlyChargeRatio"].fillna(1.0).clip(0, 5)

    # How much of the catalogue the customer actually subscribes to.
    active = np.zeros(len(df), dtype=int)
    for col in C.SERVICE_COLS:
        if col in df.columns:
            vals = df[col].astype(str).str.strip()
            active += (~vals.isin(["No", "No internet service", "No phone service"])).astype(int)
    df["NumServices"] = active

    df["ContractMonths"] = (
        df["Contract"].astype(str).str.strip().map(C.CONTRACT_TO_MONTHS).fillna(1).astype(int)
    )

    df["TenureYears"] = tenure / 12.0

    df["TenureBucket"] = pd.cut(
        tenure,
        bins=[-0.1, 6, 12, 24, 48, np.inf],
        labels=["0-6m", "6-12m", "1-2y", "2-4y", "4y+"],
    ).astype(str)

    return df


def feature_columns() -> tuple[list[str], list[str]]:
    """Return (numeric, categorical) column names after engineering."""
    numeric = C.NUMERIC_RAW + C.ENGINEERED_NUMERIC
    categorical = C.BINARY_RAW + C.MULTI_RAW + C.ENGINEERED_CATEGORICAL
    return numeric, categorical


def prepare(path=None) -> tuple[pd.DataFrame, pd.Series]:
    df = engineer_features(clean(load_raw(path)))
    y = df[C.TARGET].astype(int)
    X = df.drop(columns=[C.TARGET])
    numeric, categorical = feature_columns()
    return X[numeric + categorical], y
