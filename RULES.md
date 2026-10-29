# Attention rules

These rules turn the Assessment 2 Orange findings into a consistent first pass. `cloudcore/signals.py` implements them, and the `get_risk_signals` tool returns the result. The assistant starts from the rule suggestion, reads the actual tickets and reviews, and explains the result. **A person decides.**

## What the rules look at

| Signal | Why (Orange finding) | Scored? |
|---|---|---|
| Basic support tier | 59.7% flag rate vs 6.7% for Premium | Profile factor |
| Tenure under 12 months | Flagged accounts average 15.6 vs 29.1 months | Profile factor |
| Single product | 49% flag rate vs 13% for multi-product | Profile factor |
| Low-satisfaction ticket (≤ 2/5) | 50% flag rate vs 20.9% without one | Warning sign |
| Poor review (≤ 2/5) | Lower satisfaction among flagged accounts | Warning sign |
| Switching language or a named competitor (AWS, Azure, "evaluating alternatives") | Sentiment scoring misses switching intent | Warning sign |
| Complaint themes (CloudSync sync, integration, onboarding…) | Recurring complaint clusters | Explains the *why* |
| Region | San Francisco has a 49.2% flag rate | **Context only**: scoring it would penalise customers for where they are |
| Ticket volume | Not significantly associated with churn | **Context only** |
| Sentiment score | Misleading on its own | **Not used** |
| `churn_flag` | This is the outcome being checked against | **Never visible to the assistant** |

## Attention levels

The attention level should be based mainly on direct customer evidence. Profile information such as support tier, tenure and product count provides context, but does not determine the level by itself.

1. **High**: strong direct warning signs, such as clear switching intent, a named competitor, repeated serious complaints, or a major unresolved issue.

2. **Medium**: a clear technical or service problem with meaningful customer impact, but there is not enough evidence of switching intent, repeated failure or an unresolved issue to justify High.

3. **Uncertain**: the evidence is incomplete, old, conflicting or missing important information such as resolution status. A person should investigate before deciding.

4. **Low**: no meaningful warning signs are present and the available evidence is generally positive or routine.

Basic support tier, tenure under 12 months, single-product use and region are context only. They can help explain the situation but should not automatically increase the attention level.

If an account has no tickets or reviews, the assistant should not assume the customer is healthy or at risk. It should clearly state that the evidence is limited.

## Exploratory check (in-sample, not accuracy)

`python eval/run_rules_eval.py` compares the suggestions with the historical `churn_flag` after the fact:

| Level | Accounts | Historically flagged |
|---|---:|---:|
| High | 43 | 72.1% |
| Medium | 82 | 35.4% |
| Uncertain | 27 | 14.8% |
| Low | 128 | 5.5% |

The base rate is 25.4%. These thresholds came from the same 280 customers, so the check is **in-sample**. It shows the rules separate accounts sensibly. It doesn't show they would do so on new customers. `churn_flag` means "churned **or at risk**", so it may partly reflect the same signals, which makes the comparison circular.
