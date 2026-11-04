// PHM Coach worker: receives the conversation plus the checkpoint briefing from the
// website, asks Claude (grounded in the bundled sources), and returns the coach's reply
// and a structured report of what the learner showed. The website never sees the API key.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, journey } from "./prompt.js";

const KEY_IDS = Object.keys(journey.key_points);
const TRAP_IDS = journey.traps.map((t) => t.id);

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    heard: { type: "array", items: { type: "string" }, description: `Key point ids: ${KEY_IDS.join(", ")}` },
    traps_detected: { type: "array", items: { type: "string" }, description: `Trap ids: ${TRAP_IDS.join(", ")}` },
    traps_cleared: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "object", properties: { id: { type: "string" }, quote: { type: "string" } }, required: ["id", "quote"], additionalProperties: false } },
    sources: { type: "array", items: { type: "string" } },
    visual: { type: "string", enum: ["", "cycle", "quintuple", "groups", "pyramid", "domains", "california", "distinction"] },
    visual_highlight: { type: "number" },
    gap_probed: { type: "string" },
    test_used: { type: "string" },
    role: { type: "string", enum: ["clinician", "administrator", "leader", "volunteer", "other", "unknown"] },
    confidence: { type: "number" },
    commitment: { type: "string" },
    escalated: { type: "boolean" },
    escalation_reason: { type: "string" },
    question_summary: { type: "string" },
  },
  required: ["reply", "heard", "evidence", "sources", "visual", "visual_highlight", "traps_detected", "traps_cleared", "gap_probed", "test_used", "role", "confidence", "commitment", "escalated", "escalation_reason", "question_summary"],
  additionalProperties: false,
};

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// Best effort per-visitor limit (each worker instance keeps its own counts).
const hits = new Map();
function tooMany(ip, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20) return false;
  if (messages[messages.length - 1].role !== "user") return false;
  return messages.every(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length > 0 && m.content.length <= 4000,
  );
}

// ---- records for the PHM Advance team (no names, ever) ----------------------------------
const RECORD_TYPES = ["trained", "escalation", "handoff", "writeup"];
const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

async function saveRecord(env, body) {
  if (!/^\d{6}$/.test(String(body.learnerId || "")) || !RECORD_TYPES.includes(body.type)) return false;
  const key = `learner:${body.learnerId}`;
  const rec = (await env.PHM_RECORDS.get(key, "json")) || { id: body.learnerId, first: new Date().toISOString(), events: [] };
  const d = body.data || {};
  const event = { type: body.type, at: new Date().toISOString(),
    role: clip(d.role, 20), stage: Number.isFinite(d.stage) ? d.stage : null, commitment: clip(d.commitment, 300),
    question: clip(d.question, 500), text: clip(d.text, 2000),
    heard: Array.isArray(d.heard) ? d.heard.slice(0, 40).map((x) => clip(x, 40)) : undefined,
    traps: Array.isArray(d.traps) ? d.traps.slice(0, 40).map((x) => clip(x, 10)) : undefined };
  rec.events = [...rec.events, event].slice(-100);
  rec.last = event.at;
  if (body.type === "trained") rec.trainedAt = rec.trainedAt || event.at;
  await env.PHM_RECORDS.put(key, JSON.stringify(rec));
  return true;
}

async function listRecords(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.PHM_RECORDS.list({ prefix: "learner:", cursor });
    for (const k of page.keys) out.push(await env.PHM_RECORDS.get(k.name, "json"));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.filter(Boolean).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Team view: list records. Protected by the TEAM_TOKEN secret, not by origin.
    if (url.pathname === "/records") {
      const teamCors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization", "Access-Control-Allow-Methods": "GET, OPTIONS" };
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: teamCors });
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!env.TEAM_TOKEN || token !== env.TEAM_TOKEN) return json({ error: "Wrong team code" }, 401, teamCors);
      return json({ records: await listRecords(env) }, 200, teamCors);
    }
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST" }, 405, cors);
    if (!allowed.includes(origin)) return json({ error: "This site is not allowed" }, 403, cors);
    if (tooMany(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "Too many messages, slow down" }, 429, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    // Saved conversations, keyed by six-digit learner ID, so a learner can pick up anywhere.
    if (url.pathname === "/session/load" || url.pathname === "/session/save") {
      const id = String(body.learnerId || "");
      if (!/^\d{6}$/.test(id)) return json({ error: "Invalid learner ID" }, 400, cors);
      if (url.pathname === "/session/load") return json({ record: await env.PHM_RECORDS.get(`session:${id}`, "json") }, 200, cors);
      const r = body.record;
      const text = JSON.stringify(r || null);
      if (!r || r.id !== id || typeof r.checkpoint !== "object" || !Array.isArray(r.msgs) || text.length > 1_000_000) return json({ error: "Invalid session" }, 400, cors);
      await env.PHM_RECORDS.put(`session:${id}`, text);
      return json({ ok: true }, 200, cors);
    }
    if (url.pathname === "/record") {
      return (await saveRecord(env, body)) ? json({ ok: true }, 200, cors) : json({ error: "Invalid record" }, 400, cors);
    }
    if (!validMessages(body.messages) || typeof body.briefing !== "string" || body.briefing.length > 4000) return json({ error: "Invalid request" }, 400, cors);

    // The learner's latest words go in <learner>; the checkpoint briefing rides alongside.
    const msgs = body.messages.slice(0, -1).filter((m, i) => !(i === 0 && m.role === "assistant"));
    if (msgs.length && msgs[0].role !== "user") msgs.unshift({ role: "user", content: "[The learner opened the PHM Coach.]" });
    msgs.push({ role: "user", content: [
      { type: "text", text: `<learner>\n${body.messages.at(-1).content}\n</learner>` },
      { type: "text", text: `<checkpoint>\n${body.briefing}\n</checkpoint>` },
    ] });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: env.MODEL || "claude-opus-5-5",
        max_tokens: 16000,
        // If Claude declines, retry on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: env.EFFORT || "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: msgs,
      });

      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        return json({ reply: "I don't have a grounded answer for that, and I'd rather not guess. I've passed it to the PHM Advance team; you can also reach them at PHMAdvance@southlake.ca.",
          report: { heard: [], traps_detected: [], traps_cleared: [], escalated: true, escalation_reason: `stop_reason=${response.stop_reason}`, question_summary: "" } }, 200, cors);
      }
      const text = response.content.find((b) => b.type === "text");
      if (!text) return json({ error: "Empty reply" }, 502, cors);
      const { reply, ...report } = JSON.parse(text.text);
      // No quote, no credit: drop any key point the coach claimed without evidence.
      const quoted = new Set((report.evidence || []).filter((e) => e.quote && e.quote.trim()).map((e) => e.id));
      report.heard = (report.heard || []).filter((id) => quoted.has(id));
      return json({ reply, report }, 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return json({ error: "Server API key is missing or invalid" }, 500, cors);
      if (error instanceof Anthropic.RateLimitError) return json({ error: "Coach is busy, try again shortly" }, 429, cors);
      if (error instanceof Anthropic.BadRequestError) return json({ error: "Coach rejected the request" }, 502, cors);
      if (error instanceof Anthropic.APIError) return json({ error: `Coach error ${error.status}` }, 502, cors);
      if (error instanceof SyntaxError) return json({ error: "Coach reply was not valid JSON" }, 502, cors);
      return json({ error: "Unexpected server error" }, 500, cors);
    }
  },
};
