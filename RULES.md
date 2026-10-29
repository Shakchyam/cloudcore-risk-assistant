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

The first rule that matches sets the level.

1. **Uncertain**: switching language followed by a later positive support experience. Intent needs a person to confirm it.
2. **High**: all three profile factors are present.
3. **High**: at least one profile factor, plus a warning sign in the customer's own feedback.
4. **Medium**: at least one profile factor, but no warning sign yet. Check in; don't escalate.
5. **Uncertain**: a warning sign but a healthy profile. The signals are mixed, so a person should judge.
6. **Low**: a healthy profile and no warning signs.

If an account has no tickets or reviews, the suggestion rests on its profile alone, and the brief has to say so.

## Exploratory check (in-sample, not accuracy)

`python eval/run_rules_eval.py` compares the suggestions with the historical `churn_flag` after the fact:

| Level | Accounts | Historically flagged |
|---|---|---|
| High | 43 | 72.1% |
| Medium | 82 | 35.4% |
| Uncertain | 27 | 14.8% |
| Low | 128 | 5.5% |

The base rate is 25.4%. These thresholds came from the same 280 customers, so the check is **in-sample**. It shows the rules separate accounts sensibly. It doesn't show they would do so on new customers. `churn_flag` means "churned **or at risk**", so it may partly reflect the same signals, which makes the comparison circular.
