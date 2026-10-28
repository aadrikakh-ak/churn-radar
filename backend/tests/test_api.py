"""API tests. Run from the project root with `pytest backend/tests -v`."""
from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app.main import app  # noqa: E402

HIGH_RISK = {
    "gender": "Female", "SeniorCitizen": 1, "Partner": "No", "Dependents": "No",
    "tenure": 1, "PhoneService": "Yes", "MultipleLines": "No",
    "InternetService": "Fiber optic", "OnlineSecurity": "No", "OnlineBackup": "No",
    "DeviceProtection": "No", "TechSupport": "No", "StreamingTV": "Yes",
    "StreamingMovies": "Yes", "Contract": "Month-to-month", "PaperlessBilling": "Yes",
    "PaymentMethod": "Electronic check", "MonthlyCharges": 98.0, "TotalCharges": 98.0,
}

LOW_RISK = {
    "gender": "Male", "SeniorCitizen": 0, "Partner": "Yes", "Dependents": "Yes",
    "tenure": 70, "PhoneService": "Yes", "MultipleLines": "Yes",
    "InternetService": "DSL", "OnlineSecurity": "Yes", "OnlineBackup": "Yes",
    "DeviceProtection": "Yes", "TechSupport": "Yes", "StreamingTV": "No",
    "StreamingMovies": "No", "Contract": "Two year", "PaperlessBilling": "No",
    "PaymentMethod": "Bank transfer (automatic)", "MonthlyCharges": 62.0,
    "TotalCharges": 4340.0,
}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    body = client.get("/api/health").json()
    assert body["model_loaded"] is True, body.get("error")


def test_model_info(client):
    body = client.get("/api/model/info").json()
    assert body["model"]["inputs"] > 0
    assert body["explainer"]["method"] == "Integrated Gradients"


def test_metrics_exposes_test_scores(client):
    body = client.get("/api/model/metrics").json()
    assert 0.5 < body["test"]["roc_auc"] <= 1.0


def test_schema_drives_the_form(client):
    fields = client.get("/api/schema").json()["fields"]
    names = {f["name"] for f in fields}
    assert "Contract" in names and "tenure" in names
    contract = next(f for f in fields if f["name"] == "Contract")
    assert contract["type"] == "select"
    assert "Two year" in contract["options"]


def test_predict_high_risk(client):
    body = client.post("/api/predict", json={"customer": HIGH_RISK}).json()
    assert 0.0 <= body["churn_probability"] <= 1.0
    assert body["drivers"], "expected Integrated Gradients attributions"
    assert body["risk_band"] in {"Low", "Medium", "High", "Critical"}


def test_risk_ordering_is_sane(client):
    """The single most important behavioural test: a month-to-month fibre
    customer one month in must score above a two-year DSL veteran."""
    high = client.post("/api/predict", json={"customer": HIGH_RISK}).json()
    low = client.post("/api/predict", json={"customer": LOW_RISK}).json()
    assert high["churn_probability"] > low["churn_probability"]
    assert high["churn_probability"] > 0.5
    assert low["churn_probability"] < 0.2


def test_explanations_point_the_right_way(client):
    body = client.post("/api/predict", json={"customer": HIGH_RISK}).json()
    tenure_like = [
        d for d in body["drivers"] if d["feature"] in {"tenure", "TenureBucket", "TenureYears"}
    ]
    assert tenure_like, "short tenure should be among the drivers"
    assert any(d["direction"] == "increases" for d in tenure_like)


def test_custom_threshold_changes_the_verdict(client):
    strict = client.post("/api/predict", json={"customer": HIGH_RISK, "threshold": 0.99}).json()
    loose = client.post("/api/predict", json={"customer": HIGH_RISK, "threshold": 0.01}).json()
    assert strict["will_churn"] is False
    assert loose["will_churn"] is True
    assert strict["churn_probability"] == pytest.approx(loose["churn_probability"])


def test_what_if_contracts_reduce_risk(client):
    body = client.post("/api/what-if", json=HIGH_RISK).json()
    two_year = next(s for s in body["scenarios"] if "2-year" in s["label"])
    assert two_year["delta"] < 0, "a two-year contract must lower modelled risk"
    assert two_year["revenue_saved"] >= 0


def test_batch_json(client):
    body = client.post("/api/predict/batch", json=[HIGH_RISK, LOW_RISK]).json()
    assert body["count"] == 2
    assert body["results"][0]["churn_probability"] > body["results"][1]["churn_probability"]


def test_csv_upload_round_trip(client):
    import pandas as pd

    csv = pd.DataFrame([HIGH_RISK, LOW_RISK]).to_csv(index=False).encode()
    resp = client.post(
        "/api/predict/csv", files={"file": ("customers.csv", io.BytesIO(csv), "text/csv")}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 2


def test_csv_missing_columns_is_422(client):
    csv = b"gender,tenure\nFemale,5\n"
    resp = client.post(
        "/api/predict/csv", files={"file": ("bad.csv", io.BytesIO(csv), "text/csv")}
    )
    assert resp.status_code == 422
    assert "missing column" in resp.json()["detail"]


def test_invalid_category_is_rejected(client):
    bad = dict(HIGH_RISK, Contract="Lifetime")
    assert client.post("/api/predict", json={"customer": bad}).status_code == 422


def test_out_of_range_tenure_is_rejected(client):
    bad = dict(HIGH_RISK, tenure=-5)
    assert client.post("/api/predict", json={"customer": bad}).status_code == 422


def test_calibration_is_applied(client):
    """Platt scaling must actually move the number, not silently no-op."""
    body = client.post("/api/predict", json={"customer": HIGH_RISK}).json()
    assert body["raw_probability"] != pytest.approx(body["churn_probability"], abs=1e-6)


def test_sample_endpoints_are_scoreable(client):
    for profile in ("high", "low", "average"):
        customer = client.get(f"/api/sample?profile={profile}").json()
        resp = client.post("/api/predict", json={"customer": customer})
        assert resp.status_code == 200, resp.text
