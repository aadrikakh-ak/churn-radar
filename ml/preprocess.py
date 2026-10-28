"""The sklearn preprocessing pipeline, persisted alongside the network."""
from __future__ import annotations

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .data import feature_columns


def build_preprocessor() -> ColumnTransformer:
    numeric, categorical = feature_columns()

    numeric_pipe = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]
    )

    categorical_pipe = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )

    return ColumnTransformer(
        transformers=[
            ("num", numeric_pipe, numeric),
            ("cat", categorical_pipe, categorical),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def transformed_feature_names(preprocessor: ColumnTransformer) -> list[str]:
    return [str(n) for n in preprocessor.get_feature_names_out()]


def source_feature_map(preprocessor: ColumnTransformer) -> dict[str, str]:
    """Map every transformed column back to the raw column it came from.

    One-hot columns are named `Contract_Two year`; we need `Contract` so the
    explanation UI can aggregate 20-odd dummies into human-sized drivers.
    """
    numeric, categorical = feature_columns()
    mapping: dict[str, str] = {}
    for name in transformed_feature_names(preprocessor):
        if name in numeric:
            mapping[name] = name
            continue
        match = None
        for col in sorted(categorical, key=len, reverse=True):
            if name == col or name.startswith(col + "_"):
                match = col
                break
        mapping[name] = match or name
    return mapping
