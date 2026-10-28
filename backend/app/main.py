"""FastAPI application for Churn Radar."""
from __future__ import annotations

import io
import json
from contextlib import asynccontextmanager
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import config as cfg
from .model_service import service
from .schemas import (
    BatchResponse,
    Customer,
    PredictionResponse,
    PredictRequest,
    WhatIfResponse,
)

REQUIRED_CSV_COLUMNS = list(Customer.model_fields.keys())


@asynccontextmanager
async def lifespan(app: FastAPI):
    service.load()
    yield


app = FastAPI(
    title=cfg.API_TITLE,
    version=cfg.API_VERSION,
    description=(
        "Customer churn prediction powered by a feed-forward neural network "
        "trained on the Telco Customer Churn dataset. Every prediction ships "
        "with Integrated Gradients attributions and a retention playbook."
    ),
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _guard() -> None:
    if not service.ready:
        raise HTTPException(
            status_code=503,
            detail=service.error or "Model is still loading. Try again in a moment.",
        )


# --------------------------------------------------------------------- meta
@app.get("/api/health", tags=["meta"])
def health():
    return {
        "status": "ok" if service.ready else "degraded",
        "model_loaded": service.ready,
        "error": service.error,
        "version": cfg.API_VERSION,
    }


@app.get("/api/model/info", tags=["meta"])
def model_info():
    _guard()
    return service.info()


@app.get("/api/model/metrics", tags=["meta"])
def model_metrics():
    _guard()
    if not service.metrics:
        raise HTTPException(404, "metrics.json was not produced by the training run")
    return service.metrics


@app.get("/api/schema", tags=["meta"])
def form_schema():
    """Field definitions so the frontend builds its form from the model, not
    from hard-coded duplicates that drift the moment a column changes."""
    _guard()
    schema = service.metadata.get("schema", {})
    fields = []
    for name, info in Customer.model_json_schema()["properties"].items():
        entry = {"name": name, "label": name, "required": True}
        stats = schema.get("numeric", {}).get(name)
        options = _literal_options(info)
        if options:
            entry.update({"type": "select", "options": options})
        else:
            entry.update(
                {
                    "type": "number",
                    "min": stats["min"] if stats else info.get("minimum", 0),
                    "max": stats["max"] if stats else info.get("maximum", 1000),
                    "median": stats["median"] if stats else 0,
                }
            )
        fields.append(entry)
    return {"fields": fields, "derived": schema.get("derived", [])}


def _literal_options(info: dict) -> list | None:
    if "enum" in info:
        return info["enum"]
    for key in ("anyOf", "oneOf", "allOf"):
        for sub in info.get(key, []):
            if "enum" in sub:
                return sub["enum"]
    if info.get("const") is not None:
        return [info["const"]]
    return None


@app.get("/api/plots/{name}", tags=["meta"])
def plot(name: str):
    """Serve the PNGs written by the training run (used on the Model page)."""
    safe = Path(name).name
    path = cfg.ARTIFACTS / "plots" / safe
    if path.suffix != ".png" or not path.exists():
        raise HTTPException(404, f"no such plot: {safe}")
    return FileResponse(path, media_type="image/png")


# ------------------------------------------------------------------ predict
@app.post("/api/predict", response_model=PredictionResponse, tags=["predict"])
def predict(req: PredictRequest):
    _guard()
    try:
        return service.predict_one(
            req.customer.model_dump(),
            policy=req.threshold_policy,
            override=req.threshold,
        )
    except Exception as exc:
        raise HTTPException(500, f"prediction failed: {exc}") from exc


@app.post("/api/what-if", response_model=WhatIfResponse, tags=["predict"])
def what_if(customer: Customer):
    """Score the same customer under each retention offer."""
    _guard()
    try:
        return service.what_if(customer.model_dump())
    except Exception as exc:
        raise HTTPException(500, f"what-if failed: {exc}") from exc


@app.post("/api/predict/batch", response_model=BatchResponse, tags=["predict"])
def predict_batch(
    customers: list[Customer],
    threshold_policy: str = Query("default"),
    threshold: float | None = Query(None, ge=0.0, le=1.0),
):
    _guard()
    if not customers:
        raise HTTPException(400, "send at least one customer")
    if len(customers) > cfg.MAX_BATCH_ROWS:
        raise HTTPException(413, f"batch limit is {cfg.MAX_BATCH_ROWS} rows")
    frame = pd.DataFrame([c.model_dump() for c in customers])
    return service.predict_batch(frame, policy=threshold_policy, override=threshold)


@app.post("/api/predict/csv", response_model=BatchResponse, tags=["predict"])
async def predict_csv(
    file: UploadFile = File(...),
    threshold_policy: str = Query("default"),
    threshold: float | None = Query(None, ge=0.0, le=1.0),
):
    """Score an uploaded CSV. Accepts the raw Kaggle file as-is."""
    _guard()
    if not (file.filename or "").lower().endswith((".csv", ".txt")):
        raise HTTPException(400, "upload a .csv file")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, "file larger than 25 MB")

    try:
        frame = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(400, f"could not parse CSV: {exc}") from exc

    if frame.empty:
        raise HTTPException(400, "the file has no rows")
    if len(frame) > cfg.MAX_BATCH_ROWS:
        raise HTTPException(413, f"row limit is {cfg.MAX_BATCH_ROWS}")

    missing = [c for c in REQUIRED_CSV_COLUMNS if c not in frame.columns]
    if missing:
        raise HTTPException(
            422,
            f"missing column(s): {', '.join(missing)}. "
            f"The file needs the original Telco headers.",
        )

    # A labelled file (the Kaggle original) gets scored too; the Churn column
    # is ignored for prediction but handed back so the UI can show accuracy.
    actuals = None
    if "Churn" in frame.columns:
        actuals = (
            frame["Churn"].astype(str).str.strip().str.lower().map({"yes": 1, "no": 0}).tolist()
        )

    try:
        result = service.predict_batch(frame, policy=threshold_policy, override=threshold)
    except Exception as exc:
        raise HTTPException(500, f"scoring failed: {exc}") from exc

    if actuals is not None:
        for row, actual in zip(result["results"], actuals):
            row["actual"] = actual
    return JSONResponse(result)


@app.get("/api/sample", tags=["predict"])
def sample(profile: str = Query("high", pattern="^(high|low|average)$")):
    """Pre-filled customers so a reviewer can try the demo in one click."""
    presets = {
        "high": {
            "gender": "Female", "SeniorCitizen": 1, "Partner": "No", "Dependents": "No",
            "tenure": 2, "PhoneService": "Yes", "MultipleLines": "No",
            "InternetService": "Fiber optic", "OnlineSecurity": "No", "OnlineBackup": "No",
            "DeviceProtection": "No", "TechSupport": "No", "StreamingTV": "Yes",
            "StreamingMovies": "Yes", "Contract": "Month-to-month", "PaperlessBilling": "Yes",
            "PaymentMethod": "Electronic check", "MonthlyCharges": 95.70, "TotalCharges": 191.40,
        },
        "low": {
            "gender": "Male", "SeniorCitizen": 0, "Partner": "Yes", "Dependents": "Yes",
            "tenure": 68, "PhoneService": "Yes", "MultipleLines": "Yes",
            "InternetService": "DSL", "OnlineSecurity": "Yes", "OnlineBackup": "Yes",
            "DeviceProtection": "Yes", "TechSupport": "Yes", "StreamingTV": "No",
            "StreamingMovies": "No", "Contract": "Two year", "PaperlessBilling": "No",
            "PaymentMethod": "Bank transfer (automatic)", "MonthlyCharges": 65.15,
            "TotalCharges": 4430.20,
        },
        "average": {
            "gender": "Male", "SeniorCitizen": 0, "Partner": "No", "Dependents": "No",
            "tenure": 29, "PhoneService": "Yes", "MultipleLines": "No",
            "InternetService": "DSL", "OnlineSecurity": "No", "OnlineBackup": "Yes",
            "DeviceProtection": "No", "TechSupport": "No", "StreamingTV": "No",
            "StreamingMovies": "No", "Contract": "One year", "PaperlessBilling": "Yes",
            "PaymentMethod": "Mailed check", "MonthlyCharges": 64.80, "TotalCharges": 1879.20,
        },
    }
    return presets[profile]


# ----------------------------------------------------- static frontend (prod)
STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
if STATIC_DIR.exists():
    from fastapi.staticfiles import StaticFiles

    from starlette.exceptions import HTTPException as StarletteHTTPException

    class SPAStaticFiles(StaticFiles):
        """Serve index.html for unknown paths so a refresh or a deep link
        lands on the app rather than a 404.

        Starlette raises on a missing file rather than returning a 404
        response, so both paths have to be handled.
        """

        @staticmethod
        def _is_client_route(path: str) -> bool:
            # "/model" is a route; "/assets/index-abc.js" is a missing file and
            # must stay a 404, or the browser receives HTML where it expected
            # JavaScript and reports a confusing MIME error instead.
            if path.startswith("api"):
                return False
            return "." not in path.rsplit("/", 1)[-1]

        async def get_response(self, path: str, scope):
            try:
                response = await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code == 404 and self._is_client_route(path):
                    return await super().get_response("index.html", scope)
                raise
            if response.status_code == 404 and self._is_client_route(path):
                return await super().get_response("index.html", scope)
            return response

    app.mount("/", SPAStaticFiles(directory=STATIC_DIR, html=True), name="static")
