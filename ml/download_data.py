"""Fetch the Telco Customer Churn dataset.

    python -m ml.download_data

The file is the same 7,043-row table published on Kaggle as "Telco Customer
Churn"; it originates from IBM's sample data and is mirrored in IBM's own
public repository, which needs no Kaggle credentials. A copy is committed to
data/raw so a fresh clone trains without network access.
"""
from __future__ import annotations

import sys
import urllib.request

from . import config as C

URL = (
    "https://raw.githubusercontent.com/IBM/telco-customer-churn-on-icp4d/"
    "master/data/Telco-Customer-Churn.csv"
)

EXPECTED_ROWS = 7043


def main() -> int:
    C.DATA_RAW.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {URL}")
    try:
        urllib.request.urlretrieve(URL, C.DATA_RAW)
    except Exception as exc:
        print(f"download failed: {exc}", file=sys.stderr)
        print(
            "Alternative: download 'Telco Customer Churn' from Kaggle and save it to "
            f"{C.DATA_RAW}",
            file=sys.stderr,
        )
        return 1

    import pandas as pd

    rows = len(pd.read_csv(C.DATA_RAW))
    print(f"saved {C.DATA_RAW} ({rows} rows)")
    if rows != EXPECTED_ROWS:
        print(f"warning: expected {EXPECTED_ROWS} rows", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
