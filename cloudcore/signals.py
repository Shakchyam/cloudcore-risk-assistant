"""Warning-signal rules for the CloudCore Customer Risk Intelligence Assistant.

These rules encode the Assessment 2 Orange findings (see RULES.md). They do not
predict churn. They gather evidence and suggest an attention level that a
Customer Success person reviews. churn_flag is never an input.
"""
from __future__ import annotations
import re
from pathlib import Path
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"

# Customer's own words that signal intent to leave or a named competitor.
SWITCHING = re.compile(
    r"\b(AWS|Azure|Google Cloud|big clouds|Step Functions|considering switching|"
    r"evaluating alternatives|considering alternatives|move this to|switching cost)\b",
    re.I,
)
# "Switching cost is the only thing holding us back" = staying only because leaving is hard.
LOCKED_IN = re.compile(r"switching cost is the only thing holding us back", re.I)

THEMES = {
    "CloudSync reliability (sync failures, duplicated records)": r"\bsync|cloudsync|duplicated (half our )?records|failed overnight",
    "Integration / API breakage": r"ERP|API error|field mapping|integration|large batch",
    "Onboarding & usability": r"onboarding|learning curve|interface|docs are thin|confusing|full access",
    "Performance (slow dashboards, timeouts)": r"slow|times out|over a minute|latency",
    "Billing & pricing": r"billed twice|refund|pricing climbed|for the price|invoice",
    "Storage / backup failures": r"uploads have been failing|blocking our backups",
}
LOW_SAT = 2          # ticket satisfaction <= 2 counts as a poor support experience
POOR_RATING = 2      # review rating <= 2 counts as poor feedback
SHORT_TENURE = 12    # months


def load():
    c = pd.read_csv(DATA / "customers.csv")
    t = pd.read_csv(DATA / "support_tickets.csv")
    r = pd.read_csv(DATA / "reviews.csv")
    x = pd.read_csv(DATA / "transactions.csv")
    assert "churn_flag" not in c.columns, "churn_flag must never reach the assistant"
    return c, t, r, x


def _themes(texts: list[str]) -> dict[str, int]:
    out = {}
    for name, pat in THEMES.items():
        n = sum(bool(re.search(pat, s, re.I)) for s in texts)
        if n:
            out[name] = n
    return out


def assess(customer_id: str, c=None, t=None, r=None) -> dict:
    """Return the evidence for one account and a rule-based attention suggestion."""
    if c is None:
        c, t, r, _ = load()
    row = c[c.customer_id == customer_id]
    if row.empty:
        raise KeyError(f"Unknown customer {customer_id}")
    p = row.iloc[0]
    tk = t[t.customer_id == customer_id].sort_values("date")
    rv = r[r.customer_id == customer_id]

    feedback = [("ticket", d.date, int(d.satisfaction_score), d.ticket_text) for d in tk.itertuples()] + \
               [("review", None, int(d.rating), d.review_text) for d in rv.itertuples()]
    texts = [f[3] for f in feedback]

    switching = [f for f in feedback if SWITCHING.search(f[3])]
    low_tickets = [f for f in feedback if f[0] == "ticket" and f[2] <= LOW_SAT]
    poor_reviews = [f for f in feedback if f[0] == "review" and f[2] <= POOR_RATING]
    themes = _themes([f[3] for f in low_tickets + poor_reviews]) or {}

    profile = []
    if p.support_tier == "Basic":
        profile.append("Basic support tier")
    if p.tenure_months < SHORT_TENURE:
        profile.append(f"Short tenure ({p.tenure_months} months)")
    if "+" not in p.products:
        profile.append(f"Single product ({p.products})")

    # Conflict: switching language followed by a later clearly positive ticket.
    last_switch_date = max((f[1] for f in switching if f[1]), default=None)
    later_positive = [f for f in feedback if f[0] == "ticket" and last_switch_date
                      and f[1] > last_switch_date and f[2] >= 4]

    warning = bool(switching or low_tickets or poor_reviews)   # warning sign in the customer's own feedback
    n_items = len(feedback)
    n_prof = len(profile)
    reasons = []

    # Rule order matters: the first matching rule sets the suggestion.
    if switching and later_positive:
        level = "Uncertain"
        reasons.append("Switching language was followed by a better support experience; a person needs to confirm intent.")
    elif n_prof == 3:
        level = "High"
        reasons.append("All three profile risk factors (Basic tier, short tenure, single product) — the strongest pattern in the Orange analysis.")
    elif n_prof >= 1 and warning:
        level = "High"
        reasons.append("Profile risk factor(s) combined with a warning sign in the customer's own feedback.")
    elif n_prof >= 1:
        level = "Medium"
        reasons.append("Profile risk factor(s) but no warning sign in tickets or reviews yet — worth a check-in, not an escalation.")
    elif warning:
        level = "Uncertain"
        reasons.append("Warning sign in feedback, but a healthy profile (Premium/Standard, established, multi-product). Mixed signals — a person should judge.")
    else:
        level = "Low"
        reasons.append("Healthy profile and no warning signs in feedback.")

    if n_items == 0:
        reasons.append("No tickets or reviews on record — the suggestion rests on profile alone, so the 'why' is thin.")

    return {
        "customer_id": customer_id,
        "company_name": p.company_name,
        "rule_suggestion": level,
        "rule_reasons": reasons,
        "evidence": {
            "switching_language": [{"source": f[0], "date": f[1], "score": f[2], "text": f[3]} for f in switching],
            "staying_only_because_of_switching_cost": any(LOCKED_IN.search(s) for s in texts),
            "low_satisfaction_tickets": [{"date": f[1], "score": f[2], "text": f[3]} for f in low_tickets],
            "poor_reviews": [{"rating": f[2], "text": f[3]} for f in poor_reviews],
            "complaint_themes": themes,
            "profile_risk_factors": profile,
            "feedback_items_on_record": n_items,
            "avg_ticket_satisfaction": round(float(tk.satisfaction_score.mean()), 2) if len(tk) else None,
            "avg_review_rating": round(float(rv.rating.mean()), 2) if len(rv) else None,
        },
        "context_not_scored": {
            "region": p.region,
            "ticket_count": int(len(tk)),
            "note": "Region and ticket volume are shown for context only. Ticket volume was not a reliable signal "
                    "in the Orange analysis, and scoring by region would penalise customers for where they are.",
        },
    }
