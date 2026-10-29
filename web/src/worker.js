/**
 * CloudCore Customer Success Console — backend (Cloudflare Worker, free tier).
 *
 * Serves the console (public/index.html) and a small API behind a team passcode:
 *   GET  /api/config   models the team can pick (only providers with a key configured)
 *   GET  /api/data     the 280 pilot accounts (churn_flag was removed upstream)
 *   POST /api/chat     one model round, any provider, with tool calling; the page runs the tools
 *   GET  /api/reviews  shared human review log
 *   POST /api/reviews  record one decision
 *
 * API keys never reach the browser. A daily cap stops a leaked passcode running up a bill.
 */
import ACCOUNTS from "./accounts.json";

const PROVIDERS = {
  openai: { key: "OPENAI_API_KEY", call: callOpenAI },
  anthropic: { key: "ANTHROPIC_API_KEY", call: callAnthropic },
  gemini: { key: "GEMINI_API_KEY", call: callGemini },
};
const MAX_OUTPUT_TOKENS = 3000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      if (!env.TEAM_PASSCODE) return json({ error: "not_configured", message: "The server has no TEAM_PASSCODE set yet." }, 500);
      if (!safeEqual(req.headers.get("x-team-passcode") || "", env.TEAM_PASSCODE)) return json({ error: "unauthorized", message: "Wrong team passcode." }, 401);
      const route = `${req.method} ${url.pathname}`;
      if (route === "GET /api/config") return json({ models: models(env), daily_limit: limit(env) });
      if (route === "GET /api/data") return json({ accounts: ACCOUNTS });
      if (route === "POST /api/chat") return await chat(await req.json(), env);
      if (route === "GET /api/reviews") return json({ reviews: await getReviews(env) });
      if (route === "POST /api/reviews") return await addReview(await req.json(), env);
      return json({ error: "not_found", message: "No such endpoint." }, 404);
    } catch (e) {
      return json({ error: e.code || "server_error", message: e.message || "Server error." }, e.status || 500);
    }
  },
};

/* ---------------- config ---------------- */
function models(env) {
  let list = [];
  try { list = JSON.parse(env.MODELS || "[]"); } catch { throw err("bad_config", "MODELS in wrangler.toml is not valid JSON.", 500); }
  return list.filter(m => (PROVIDERS[m.provider] && env[PROVIDERS[m.provider].key]) || (m.provider === "mock" && env.MOCK === "1"))
    .map(({ provider, id, label }) => ({ provider, id, label }));
}
const limit = env => Number(env.DAILY_LIMIT || 400);

/* ---------------- chat ---------------- */
async function chat(body, env) {
  const model = models(env).find(m => m.id === body.model);
  if (!model) throw err("bad_model", `Model "${body.model}" isn't enabled on this server.`, 400);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  if (!messages.length) throw err("bad_request", "No messages.", 400);
  const system = String(body.system || "").slice(0, 120000);
  const tools = Array.isArray(body.tools) ? body.tools.slice(0, 8) : [];
  await countUsage(env);
  if (model.provider === "mock") return json(mockModel(messages));
  const out = await PROVIDERS[model.provider].call({ model: model.id, system, messages, tools, key: env[PROVIDERS[model.provider].key] });
  return json(out);
}

async function countUsage(env) {
  if (!env.STORE) return;
  const key = "usage:" + new Date().toISOString().slice(0, 10);
  const n = Number(await env.STORE.get(key) || 0);
  if (n >= limit(env)) throw err("daily_limit", "The team's daily assistant limit has been reached. It resets at midnight UTC.", 429);
  await env.STORE.put(key, String(n + 1), { expirationTtl: 60 * 60 * 48 });
}

/* Neutral message format used by the page:
 *   {role:"user", content}  {role:"assistant", content, tool_calls:[{id,name,arguments}]}  {role:"tool", tool_call_id, name, content}
 * Each adapter converts it to the provider's format and returns {text, tool_calls, truncated}. */

async function callOpenAI({ model, system, messages, tools, key }) {
  // OpenAI Responses API (current models are offered there first).
  const input = [];
  for (const m of messages) {
    if (m.role === "user") input.push({ role: "user", content: String(m.content) });
    else if (m.role === "assistant") {
      if (m.content) input.push({ role: "assistant", content: String(m.content) });
      for (const c of m.tool_calls || []) input.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.arguments || {}) });
    } else if (m.role === "tool") input.push({ type: "function_call_output", call_id: m.tool_call_id, output: String(m.content) });
  }
  const body = { model, instructions: system, input, max_output_tokens: MAX_OUTPUT_TOKENS, store: false };
  if (tools.length) body.tools = tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));
  const r = await post("https://api.openai.com/v1/responses", body, { authorization: `Bearer ${key}` }, "OpenAI");
  let text = ""; const tool_calls = [];
  for (const item of r.output || []) {
    if (item.type === "message") for (const c of item.content || []) { if (c.type === "output_text") text += c.text; }
    if (item.type === "function_call") tool_calls.push({ id: item.call_id, name: item.name, arguments: parseArgs(item.arguments) });
  }
  return { text, tool_calls, truncated: r.status === "incomplete" };
}

async function callAnthropic({ model, system, messages, tools, key }) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: String(m.content) });
    else if (m.role === "assistant") {
      const blocks = [];
      if (m.content) blocks.push({ type: "text", text: String(m.content) });
      for (const c of m.tool_calls || []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.arguments || {} });
      if (blocks.length) out.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content) };
      const prev = out[out.length - 1];
      if (prev?.role === "user" && Array.isArray(prev.content) && prev.content.every(b => b.type === "tool_result")) prev.content.push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  const body = { model, system, max_tokens: MAX_OUTPUT_TOKENS, messages: out };
  if (tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const r = await post("https://api.anthropic.com/v1/messages", body, { "x-api-key": key, "anthropic-version": "2023-06-01" }, "Anthropic");
  let text = ""; const tool_calls = [];
  for (const b of r.content || []) {
    if (b.type === "text") text += b.text;
    if (b.type === "tool_use") tool_calls.push({ id: b.id, name: b.name, arguments: b.input || {} });
  }
  return { text, tool_calls, truncated: r.stop_reason === "max_tokens" };
}

async function callGemini({ model, system, messages, tools, key }) {
  // Google's OpenAI-compatible Chat Completions endpoint (has a free tier).
  const out = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: String(m.content) });
    else if (m.role === "assistant") out.push({ role: "assistant", content: m.content || null,
      ...(m.tool_calls?.length ? { tool_calls: m.tool_calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } })) } : {}) });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.tool_call_id, content: String(m.content) });
  }
  const body = { model, messages: out, max_tokens: MAX_OUTPUT_TOKENS * 2 };
  if (tools.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const r = await post("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", body, { authorization: `Bearer ${key}` }, "Gemini");
  const msg = r.choices?.[0]?.message || {};
  return { text: msg.content || "", truncated: r.choices?.[0]?.finish_reason === "length",
    tool_calls: (msg.tool_calls || []).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function?.name, arguments: parseArgs(c.function?.arguments) })) };
}

async function post(url, body, headers, who) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error?.message || data.message || (Array.isArray(data) && data[0]?.error?.message) || `HTTP ${res.status}`;
    throw err("provider_error", `${who} returned an error: ${detail}`, res.status === 429 ? 429 : 502);
  }
  return data;
}
const parseArgs = a => { if (a && typeof a === "object") return a; try { return JSON.parse(a || "{}"); } catch { return {}; } };

/* Local testing only (MOCK=1 in .dev.vars): calls get_account once, then writes a short brief. */
function mockModel(messages) {
  const last = messages[messages.length - 1];
  if (last.role === "user") {
    const id = (String(last.content).match(/C\d{4}/) || [])[0];
    if (id) return { text: "", tool_calls: [{ id: "mock_1", name: "get_account", arguments: { customer_id: id } }] };
    return { text: "", tool_calls: [{ id: "mock_1", name: "find_accounts", arguments: { min_level: "High", limit: 3 } }] };
  }
  const data = parseArgs(last.content);
  if (Array.isArray(data)) return { text: "| # | Account | Level |\n|---|---|---|\n" + data.map((a, i) => `| ${i + 1} | ${a.company} (${a.id}) | ${a.level} |`).join("\n") };
  return { text: `## ${data.company} (${data.id}) — Attention: ${data.level}\n\n**Why this account may need attention** ${data.reasons?.[0] || ""}\n\n_Mock model for local testing._` };
}

/* ---------------- review log ---------------- */
async function getReviews(env) {
  if (!env.STORE) return [];
  return JSON.parse(await env.STORE.get("reviews") || "[]");
}
async function addReview(b, env) {
  if (!env.STORE) throw err("not_configured", "The review log needs the STORE KV namespace (see DEPLOY.md).", 500);
  const LV = ["High", "Medium", "Uncertain", "Low"];
  if (!ACCOUNTS.some(a => a.id === b.customerId) || !LV.includes(b.assistantLevel) || !LV.includes(b.finalLevel) || !["accept", "override", "defer"].includes(b.decision))
    throw err("bad_request", "That decision is missing a customer, level or decision type.", 400);
  const rec = { customerId: b.customerId, company: String(b.company || "").slice(0, 120), assistantLevel: b.assistantLevel, decision: b.decision,
    finalLevel: b.finalLevel, note: String(b.note || "").slice(0, 500), reviewer: String(b.reviewer || "Team member").slice(0, 80), at: new Date().toISOString() };
  const list = await getReviews(env);
  list.unshift(rec);
  await env.STORE.put("reviews", JSON.stringify(list.slice(0, 2000)));
  return json({ ok: true, review: rec });
}

/* ---------------- helpers ---------------- */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
function err(code, message, status) { return Object.assign(new Error(message), { code, status }); }
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
