"""Central configuration for the churn-ANN project."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_RAW = ROOT / "data" / "raw" / "telco.csv"
ARTIFACTS = ROOT / "artifacts"
PLOTS = ARTIFACTS / "plots"

TARGET = "Churn"
ID_COL = "customerID"

RANDOM_SEED = 42
TEST_SIZE = 0.15
VAL_SIZE = 0.15  # fraction of the full dataset

# ---------------------------------------------------------------- model
ARCHITECTURE = [128, 64, 32]
DROPOUT = [0.40, 0.30, 0.20]
L2_REG = 1e-4
LEARNING_RATE = 1e-3
BATCH_SIZE = 64
EPOCHS = 200
PATIENCE = 25

# Number of independently-seeded networks averaged into the final model.
# 1 = a single ANN; 5 was the best accuracy / training-time trade-off.
ENSEMBLE_SIZE = 5
ENSEMBLE_SEEDS = [11, 22, 33, 44, 55]

# ---------------------------------------------------------------- business
# Cost of losing a customer we failed to flag vs. cost of a retention offer
# wasted on somebody who was never going to leave.
COST_FALSE_NEGATIVE = 5.0
COST_FALSE_POSITIVE = 1.0

# Raw columns kept from the Kaggle file (customerID is dropped).
NUMERIC_RAW = ["tenure", "MonthlyCharges", "TotalCharges", "SeniorCitizen"]

BINARY_RAW = ["gender", "Partner", "Dependents", "PhoneService", "PaperlessBilling"]

MULTI_RAW = [
    "MultipleLines",
    "InternetService",
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
    "Contract",
    "PaymentMethod",
]

# Columns produced by feature engineering (see ml/data.py)
ENGINEERED_NUMERIC = [
    "AvgChargesPerMonth",
    "ChargesDelta",
    "NumServices",
    "ContractMonths",
    "TenureYears",
    "MonthlyChargeRatio",
]

ENGINEERED_CATEGORICAL = ["TenureBucket"]

SERVICE_COLS = [
    "PhoneService",
    "MultipleLines",
    "InternetService",
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
]

CONTRACT_TO_MONTHS = {"Month-to-month": 1, "One year": 12, "Two year": 24}
