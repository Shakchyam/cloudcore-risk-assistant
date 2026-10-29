#!/usr/bin/env bash
# Monday-morning watch-list, run headless with the same harness (CLAUDE.md, skills, MCP server).
# Schedule with cron (e.g. `0 7 * * 1`) or a GitHub Action, then post the output to the
# Customer Success Slack channel or inbox. Needs Claude Code installed and logged in.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/prepare_data.py            # refresh from the latest export
mkdir -p reports
claude -p "Use the weekly-watchlist skill to produce this week's call list." \
  --allowedTools "mcp__cloudcore-risk__find_accounts,mcp__cloudcore-risk__get_risk_signals,mcp__cloudcore-risk__get_review_log" \
  > "reports/watchlist-$(date +%F).md"
echo "Saved reports/watchlist-$(date +%F).md"
# Optional: curl -X POST -H 'Content-type: application/json' --data "{\"text\": \"$(cat reports/watchlist-$(date +%F).md)\"}" "$SLACK_WEBHOOK_URL"
