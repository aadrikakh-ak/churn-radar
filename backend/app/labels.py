"""Human-readable names and copy for every feature the model sees.

The UI shows these, never the raw column names: "Contract type" beats
"ContractMonths" for anyone reading a retention dashboard.
"""
from __future__ import annotations

LABELS: dict[str, str] = {
    "gender": "Gender",
    "SeniorCitizen": "Senior citizen",
    "Partner": "Has a partner",
    "Dependents": "Has dependents",
    "tenure": "Tenure",
    "PhoneService": "Phone service",
    "MultipleLines": "Multiple lines",
    "InternetService": "Internet service",
    "OnlineSecurity": "Online security",
    "OnlineBackup": "Online backup",
    "DeviceProtection": "Device protection",
    "TechSupport": "Tech support",
    "StreamingTV": "Streaming TV",
    "StreamingMovies": "Streaming movies",
    "Contract": "Contract type",
    "PaperlessBilling": "Paperless billing",
    "PaymentMethod": "Payment method",
    "MonthlyCharges": "Monthly charges",
    "TotalCharges": "Total charges",
    # engineered
    "AvgChargesPerMonth": "Average bill to date",
    "ChargesDelta": "Bill vs. historical average",
    "NumServices": "Services subscribed",
    "ContractMonths": "Contract length",
    "TenureYears": "Tenure (years)",
    "MonthlyChargeRatio": "Bill inflation ratio",
    "TenureBucket": "Tenure band",
}

UNITS: dict[str, str] = {
    "tenure": "months",
    "MonthlyCharges": "$/mo",
    "TotalCharges": "$",
    "AvgChargesPerMonth": "$/mo",
    "ChargesDelta": "$/mo",
    "ContractMonths": "months",
    "TenureYears": "years",
}

# Plain-English explanation of each engineered feature, surfaced in the UI so
# a reviewer can see the model is not using magic numbers.
FEATURE_NOTES: dict[str, str] = {
    "AvgChargesPerMonth": "Total charges divided by tenure — what the customer has actually paid per month on average.",
    "ChargesDelta": "Current monthly bill minus the historical average. Positive means a recent price increase.",
    "NumServices": "How many of the nine add-on services the customer subscribes to.",
    "ContractMonths": "Contract type expressed in months (1, 12 or 24).",
    "TenureYears": "Tenure in years, giving the network a smoother scale alongside raw months.",
    "MonthlyChargeRatio": "Current bill divided by the historical average, capped at 5.",
    "TenureBucket": "Tenure grouped into 0-6m, 6-12m, 1-2y, 2-4y and 4y+ bands.",
}

RISK_BANDS = [
    (0.20, "Low"),
    (0.40, "Medium"),
    (0.65, "High"),
    (1.01, "Critical"),
]


def risk_band(p: float) -> str:
    for ceiling, name in RISK_BANDS:
        if p < ceiling:
            return name
    return "Critical"


def label_for(feature: str) -> str:
    return LABELS.get(feature, feature)
