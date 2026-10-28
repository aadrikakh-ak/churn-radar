"""Request/response contracts. Pydantic enforces the valid category levels so
a typo reaches the client as a 422 instead of silently one-hot encoding to all
zeros and returning a confident, meaningless prediction."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

YesNo = Literal["Yes", "No"]


class Customer(BaseModel):
    """One Telco customer, using the Kaggle column names verbatim."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "gender": "Female",
                "SeniorCitizen": 0,
                "Partner": "No",
                "Dependents": "No",
                "tenure": 2,
                "PhoneService": "Yes",
                "MultipleLines": "No",
                "InternetService": "Fiber optic",
                "OnlineSecurity": "No",
                "OnlineBackup": "No",
                "DeviceProtection": "No",
                "TechSupport": "No",
                "StreamingTV": "Yes",
                "StreamingMovies": "Yes",
                "Contract": "Month-to-month",
                "PaperlessBilling": "Yes",
                "PaymentMethod": "Electronic check",
                "MonthlyCharges": 95.70,
                "TotalCharges": 191.40,
            }
        }
    )

    gender: Literal["Female", "Male"]
    SeniorCitizen: Literal[0, 1] = 0
    Partner: YesNo = "No"
    Dependents: YesNo = "No"
    tenure: int = Field(ge=0, le=120, description="Months with the company")
    PhoneService: YesNo = "Yes"
    MultipleLines: Literal["Yes", "No", "No phone service"] = "No"
    InternetService: Literal["DSL", "Fiber optic", "No"] = "Fiber optic"
    OnlineSecurity: Literal["Yes", "No", "No internet service"] = "No"
    OnlineBackup: Literal["Yes", "No", "No internet service"] = "No"
    DeviceProtection: Literal["Yes", "No", "No internet service"] = "No"
    TechSupport: Literal["Yes", "No", "No internet service"] = "No"
    StreamingTV: Literal["Yes", "No", "No internet service"] = "No"
    StreamingMovies: Literal["Yes", "No", "No internet service"] = "No"
    Contract: Literal["Month-to-month", "One year", "Two year"] = "Month-to-month"
    PaperlessBilling: YesNo = "Yes"
    PaymentMethod: Literal[
        "Electronic check",
        "Mailed check",
        "Bank transfer (automatic)",
        "Credit card (automatic)",
    ] = "Electronic check"
    MonthlyCharges: float = Field(ge=0, le=1000)
    TotalCharges: float = Field(ge=0, le=100000)


class Driver(BaseModel):
    feature: str
    label: str
    value: str
    contribution: float
    direction: Literal["increases", "decreases"]


class PredictionResponse(BaseModel):
    churn_probability: float = Field(description="Calibrated probability in [0, 1]")
    raw_probability: float = Field(description="Network output before Platt scaling")
    will_churn: bool
    risk_band: Literal["Low", "Medium", "High", "Critical"]
    threshold: float
    threshold_policy: str
    confidence: float = Field(description="Distance from the decision boundary, 0-1")
    drivers: list[Driver]
    baseline_probability: float
    expected_revenue_at_risk: float
    recommended_actions: list[str]
    latency_ms: float


class BatchRow(PredictionResponse):
    row: int
    customer_id: str | None = None


class BatchResponse(BaseModel):
    count: int
    flagged: int
    mean_probability: float
    total_revenue_at_risk: float
    threshold: float
    results: list[BatchRow]
    latency_ms: float


class WhatIfScenario(BaseModel):
    label: str
    change: str
    churn_probability: float
    delta: float
    revenue_saved: float


class WhatIfResponse(BaseModel):
    current: float
    scenarios: list[WhatIfScenario]


class PredictRequest(BaseModel):
    customer: Customer
    threshold_policy: Literal["default", "f1_optimal", "cost_optimal", "high_recall"] = "default"
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
