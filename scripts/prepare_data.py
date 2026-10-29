"""Prepare the assistant's data folder from CloudCore's raw extracts.

The raw extracts (source_data/) contain churn_flag. The assistant must never
see it, so this script writes copies to data/ with that column removed, and
moves the labels to eval/labels.csv where only the evaluation script reads them.

Run:  python scripts/prepare_data.py
In production this step is replaced by the nightly CRM / helpdesk export.
"""
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT, EVAL = ROOT / "source_data", ROOT / "data", ROOT / "eval"
BLOCKED = {"churn_flag"}

OUT.mkdir(exist_ok=True)
EVAL.mkdir(exist_ok=True)

customers = pd.read_csv(SRC / "cloudcore_customers.csv")
customers[["customer_id", "churn_flag"]].to_csv(EVAL / "labels.csv", index=False)
customers.drop(columns=list(BLOCKED)).to_csv(OUT / "customers.csv", index=False)

for name in ["support_tickets", "reviews", "transactions"]:
    df = pd.read_csv(SRC / f"cloudcore_{name}.csv")
    df.drop(columns=[c for c in df.columns if c in BLOCKED]).to_csv(OUT / f"{name}.csv", index=False)

for f in OUT.glob("*.csv"):
    assert "churn_flag" not in pd.read_csv(f, nrows=1).columns, f
print(f"Wrote {len(list(OUT.glob('*.csv')))} files to data/ (churn_flag removed) and eval/labels.csv")
