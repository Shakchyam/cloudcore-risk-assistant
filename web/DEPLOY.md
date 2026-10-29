# Deploy the CloudCore console for your team (free, about 15 minutes)

This puts the console on a free Cloudflare address like `https://cloudcore-console.<you>.workers.dev`.

- **What teammates do:** open the link, type their name and the team passcode, and pick a model (Claude, GPT or Gemini).
- **Who pays:** your API keys stay on the server and are never sent to anyone's browser. You pay for every assistant call the team makes.

## What it costs

| Part | Cost |
|---|---|
| Cloudflare Workers + KV (hosting, review log) | Free tier: 100,000 requests a day; KV allows 1,000 writes a day |
| Claude or GPT API calls | Pay-as-you-go. An account brief costs roughly 1–3 US cents; a demo plus testing should be a few dollars at most |
| Gemini API | Has a free tier (Google may use free-tier data to improve its products) |

**Set a monthly spend limit** in each provider's console (OpenAI → Settings → Limits; Anthropic Console → Billing → Limits). The server also stops after `DAILY_LIMIT` assistant calls per day; the default is 400, set in `wrangler.toml`.

## 1. Get an API key (one or more)

- **Anthropic (Claude):** console.anthropic.com → API Keys → Create key. Add a few dollars of credit.
- **OpenAI (GPT):** platform.openai.com → API keys → Create new secret key. Add a few dollars of credit.
- **Google (Gemini, free tier):** aistudio.google.com → Get API key.

A ChatGPT Plus or Claude Pro subscription doesn't include API access. These keys are billed separately.

## 2. Install the tools

Install **Node.js 20 or newer** from nodejs.org. Then, in a terminal inside this `web` folder:

```bash
npm install
npx wrangler login              # opens the browser; sign up for a free Cloudflare account if needed
```

## 3. Create the review-log storage

```bash
npx wrangler kv namespace create STORE
```

Copy the `id` it prints into `wrangler.toml`, replacing `PASTE_KV_NAMESPACE_ID_HERE`.

## 4. Add your secrets

Run each command and paste the value when asked. Skip any provider you're not using.

```bash
npx wrangler secret put TEAM_PASSCODE        # pick something your team can type, e.g. 3 random words
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
```

## 5. Check the model names

Open `wrangler.toml` and look at `MODELS`. Each entry is one option in the assistant's model picker.

- Make sure each `id` matches a model your account can use. Check the model list in the OpenAI, Anthropic or Google dashboard; names change often.
- Rename the `label`, or delete any lines you don't want.
- A model only appears if that provider's key is set.

## 6. Deploy

```bash
npx wrangler deploy
```

It prints your URL. Open it, sign in with the passcode, open a customer and select **Get AI brief**. If a model name is wrong, the assistant shows the provider's error message in the chat. Fix the `id` in `wrangler.toml` and deploy again.

## 7. Share it

Send teammates the URL and the passcode. To lock everyone out, change the passcode with `npx wrangler secret put TEAM_PASSCODE`.

## Updating the data or the page

From the project root:

```bash
python scripts/prepare_data.py          # refresh data/ from source_data/
python scripts/export_console_data.py   # rebuilds web/public/index.html and web/src/accounts.json
cd web && npx wrangler deploy
```

## Try it locally first (no keys needed)

```bash
cd web
printf 'TEAM_PASSCODE="test-passcode"\nMOCK="1"\n' > .dev.vars
npx wrangler dev
```

Open http://localhost:8787 and use passcode `test-passcode`. The **Mock model** returns canned answers, so you can click through everything at no cost. It never appears on the deployed site.

## How it fits together

```
Browser (console page) ──► Cloudflare Worker ──► OpenAI / Anthropic / Gemini API
      │  runs the tools            │  checks passcode, daily cap
      │  (customer lookups)        │  holds API keys
      └────────────────────────────┴──► KV: review log + usage counter
```

The model asks for customer data through 3 tools (`find_accounts`, `get_account`, `get_review_log`). The page answers them from the same rules as the MCP server in `cloudcore/`. Historical churn labels are never part of the data.
