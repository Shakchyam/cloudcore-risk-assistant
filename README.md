# CloudCore Customer Risk Intelligence Assistant

This is decision support for CloudCore's Customer Success team. It answers "which accounts need attention this week, and why?" using live customer, support and review data. A person reviews every result.

```
CloudCore data ──► MCP data server ──► Assistant (CLAUDE.md + skills) ──► Brief / watch-list ──► Human review (logged)
 (CRM / helpdesk;     (churn_flag          (Claude Code, Claude Desktop,
  CSVs in the pilot)   stripped)            or the scheduled weekly run)
```

## What's in the box

| Path | What it is |
|---|---|
| `cloudcore/server.py` | MCP server with 7 tools: `get_customer`, `get_support_history`, `get_reviews`, `get_risk_signals`, `find_accounts`, `log_review`, `get_review_log` |
| `cloudcore/signals.py` + `RULES.md` | Attention rules built from the Assessment 2 Orange findings |
| `CLAUDE.md` | The assistant's role and hard rules |
| `.claude/skills/account-brief` | Single-account assessment and call prep |
| `.claude/skills/weekly-watchlist` | Prioritised call list, at most 10 accounts |
| `.claude/settings.json` + `.claude/hooks/block_labels.py` | Read-only permissions; `log_review` asks first; the hook blocks any attempt to read churn labels |
| `scripts/prepare_data.py` | Builds `data/` from the raw extracts, removing `churn_flag` |
| `scripts/weekly_run.sh` | Headless Monday run (cron or GitHub Action), with an optional Slack post |
| `eval/run_rules_eval.py` | Compares the rules with historical outcomes *after the fact* |
| `examples/` | Real outputs from the harness |

## Setup (5 minutes)

```bash
pip install -r requirements.txt
python scripts/prepare_data.py
```

### Option A: Claude Code
```bash
cd cloudcore-risk-assistant
claude            # accept the trust prompt and approve the cloudcore-risk MCP server
```
Then ask, for example: *"Who should we call this week in San Francisco?"*, *"Brief me on C0085"*, or *"Log that I accept High for C0085 — Priya Nair."*

### Option B: Claude Desktop (for Customer Success staff, no terminal)
1. Settings → Developer → Edit config, then add the following (use your absolute path):
   ```json
   { "mcpServers": { "cloudcore-risk": { "command": "python3",
       "args": ["/ABSOLUTE/PATH/cloudcore-risk-assistant/run_server.py"] } } }
   ```
2. Create a Project and paste `CLAUDE.md` and `RULES.md` into its instructions.
3. Settings → Capabilities → Skills: upload the `account-brief` and `weekly-watchlist` folders, zipped.
4. Restart Claude Desktop and ask in plain English.

### Option C: Scheduled weekly list
`scripts/weekly_run.sh`. Schedule it for 7am on Mondays, and set `SLACK_WEBHOOK_URL` to post to the CS channel.

## Check the rules
```bash
python eval/run_rules_eval.py
```
The results are in-sample on 280 customers. See RULES.md for the limits.

## Moving from pilot to production
Replace `load()` in `cloudcore/signals.py` with calls to the CRM and helpdesk APIs. The tools, skills and guardrails stay the same.

## Hosted console
`console/console.html` is the same assistant built into an internal Customer Success console: a call list, account records, a chat panel and a shared review log. `python scripts/export_console_data.py` rebuilds it from `data/`, using the same rules. It is published as a private claude.ai artifact, and the team opens it through the share link.

## Self-hosted console (any AI provider, no Claude account needed)
`web/` is the same console on a free Cloudflare Worker. It has a team passcode, a model picker (Claude, GPT or Gemini, using your API keys held on the server), a shared review log and a daily usage cap. See `web/DEPLOY.md`.
