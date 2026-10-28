"""Backend settings. Every path can be overridden with an env var so the same
image runs locally, in Docker and on a PaaS without edits."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent

ARTIFACTS = Path(os.getenv("ARTIFACTS_DIR", PROJECT_ROOT / "artifacts"))

MODEL_PATH = ARTIFACTS / "model.keras"
PREPROCESSOR_PATH = ARTIFACTS / "preprocessor.joblib"
METADATA_PATH = ARTIFACTS / "metadata.json"
METRICS_PATH = ARTIFACTS / "metrics.json"

# Comma-separated list, or "*" to allow everything (the default, since the
# API is public and read-only).
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

MAX_BATCH_ROWS = int(os.getenv("MAX_BATCH_ROWS", "10000"))
IG_STEPS = int(os.getenv("IG_STEPS", "64"))
TOP_DRIVERS = int(os.getenv("TOP_DRIVERS", "8"))

API_TITLE = "Churn Radar API"
API_VERSION = "1.0.0"
