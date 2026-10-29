"""Compare rule suggestions with historical churn_flag AFTER the fact.

churn_flag is read here only, never by the assistant. This is an exploratory
check on 280 customers, not a measure of predictive accuracy.
Run:  python eval/run_rules_eval.py
"""
import sys
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cloudcore.signals import load, assess

c, t, r, _ = load()
lab = pd.read_csv(Path(__file__).parent / "labels.csv").set_index("customer_id").churn_flag
cases = pd.read_csv(Path(__file__).parent / "test_cases.csv")

print("Teammate's 10 test customers (ChatGPT prototype vs rules)\n")
for row in cases.itertuples():
    a = assess(row.customer_id, c, t, r)
    print(f"{row.customer_id}  rules={a['rule_suggestion']:<9} prototype={row.prototype_level:<9} historical_flag={lab[row.customer_id]}")

res = pd.DataFrame([(assess(i, c, t, r)["rule_suggestion"], lab[i]) for i in c.customer_id], columns=["level", "flag"])
print(f"\nAll {len(res)} customers (base flag rate {res.flag.mean():.1%})\n")
summary = res.groupby("level").flag.agg(accounts="count", flagged="sum", flag_rate="mean").reindex(["High", "Medium", "Uncertain", "Low"])
summary["flag_rate"] = (summary.flag_rate * 100).round(1).astype(str) + "%"
print(summary.to_string())
