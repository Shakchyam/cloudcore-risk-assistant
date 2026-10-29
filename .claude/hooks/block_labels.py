#!/usr/bin/env python3
"""PreToolUse guardrail: stop the assistant reading churn labels.

The MCP server already strips churn_flag. This hook closes the side door:
the raw extracts in source_data/ and the evaluation labels in eval/labels.csv.
Exit code 2 blocks the tool call and shows the reason to the model.
"""
import json
import sys

BLOCKED = ("source_data", "labels.csv", "churn_flag")

event = json.load(sys.stdin)
payload = json.dumps(event.get("tool_input", {})).lower()
if any(b.lower() in payload for b in BLOCKED):
    print(
        "Blocked: churn labels and raw extracts are off-limits to the assistant. "
        "Use the cloudcore-risk MCP tools; outcomes are compared only by eval/run_rules_eval.py.",
        file=sys.stderr,
    )
    sys.exit(2)
sys.exit(0)
