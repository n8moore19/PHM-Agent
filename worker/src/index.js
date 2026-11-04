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
    gap_probed: { type: "string" },
    test_used: { type: "string" },
    role: { type: "string", enum: ["clinician", "administrator", "leader", "volunteer", "other", "unknown"] },
    confidence: { type: "number" },
    commitment: { type: "string" },
    escalated: { type: "boolean" },
    escalation_reason: { type: "string" },
    question_summary: { type: "string" },
  },
  required: ["reply", "heard", "traps_detected", "traps_cleared", "gap_probed", "test_used", "role", "confidence", "commitment", "escalated", "escalation_reason", "question_summary"],
  additionalProperties: false,
};

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// Best effort per-visitor limit (each worker instance keeps its own counts).
const hits = new Map();
function tooMany(ip, limit = 20, windowMs = 60_000) {
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

export default {
  async fetch(request, env) {
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
