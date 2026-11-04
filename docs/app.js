// PHM Coach, browser app. Holds the learner's checkpoint, talks to the live coach
// (Cloudflare Worker) when configured, and falls back to the built-in demo coach.
import { createCheckpoint } from "./lib/checkpoint.js";
import { offlineTurn, escalationLine, INBOX } from "./lib/offline.js";

const $ = (id) => document.getElementById(id);
const TEAM = new URLSearchParams(location.search).has("team");
// ?ai=<url> points the page at a different coach (e.g. a local worker) for testing.
const AI_URL = (new URLSearchParams(location.search).get("ai") || window.PHM_AI_URL || "").trim();
const STORE = "phm-coach:";

const OPENING = "Hi! I'm the PHM Coach, Southlake's conversational trainer for Population Health Management. We'll learn by working through a few real situations together, and there are no wrong answers. Before we get into any frameworks: think about where you live, and one other person who lives there. Where is it?";

let journey, ck, rec; // rec = { id, created, checkpoint, msgs:[{from,text,esc}], ai:[{role,content}], shared }

// ---- storage (per browser; wrapped because storage can be blocked) -----------------
const load = (id) => { try { return JSON.parse(localStorage.getItem(STORE + id)); } catch { return null; } };
const save = () => { try { rec.updated = new Date().toISOString(); localStorage.setItem(STORE + rec.id, JSON.stringify(rec)); localStorage.setItem(STORE + "last", rec.id); } catch {} };
const newId = () => { let id; do id = String(100000 + Math.floor(Math.random() * 900000)); while (load(id)); return id; };

// ---- rendering --------------------------------------------------------------------------
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function format(s) {
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split("\n");
  let html = "", list = false;
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/);
    if (m) { if (!list) { html += "<ul>"; list = true; } html += `<li>${m[1]}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (list ? "</ul>" : "");
}
function addMsg(m, store = true) {
  const d = document.createElement("div");
  d.className = `msg ${m.from}${m.esc ? " escalated" : ""}`;
  d.innerHTML = m.from === "coach" ? format(m.text) : `<p>${esc(m.text)}</p>`;
  if (m.esc) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "Passed to the PHM Advance team"; d.appendChild(t); }
  $("log").appendChild(d); $("log").scrollTop = 1e9;
  if (store) rec.msgs.push(m);
}
function renderProgress() {
  const cp = rec.checkpoint;
  $("share").hidden = cp.outcome !== "trained";
  // Learners never see the checkpoint; only the team view shows the stage track.
  $("track").hidden = !TEAM;
  if (!TEAM) return;
  $("track").innerHTML = "";
  journey.stages.forEach((s, i) => {
    const el = document.createElement("span");
    el.className = "step " + (cp.outcome === "trained" || i < cp.stage ? "done" : i === cp.stage ? "now" : "");
    el.textContent = `${i}. ${s.name.split(":")[0]}`; $("track").appendChild(el);
  });
  const t = document.createElement("span");
  t.className = "step " + (cp.outcome === "trained" ? "trained" : "");
  t.textContent = cp.outcome === "trained" ? "PHM Trained ✓" : "PHM Trained";
  $("track").appendChild(t);
}
function renderTeam(events = []) {
  if (!TEAM) return;
  const cp = rec.checkpoint;
  $("cpSummary").textContent = `Stage ${cp.stage} · role ${cp.role} · step-backs ${cp.stepbacks} · outcome ${cp.outcome}` +
    (cp.confidence !== null ? ` · confidence ${cp.confidence}/10` : "") + (cp.probe?.gap ? ` · probing ${cp.probe.gap} (${cp.probe.count})` : "");
  $("kps").innerHTML = "";
  for (const [id, k] of Object.entries(journey.key_points)) {
    const on = cp.heard.includes(id), d = document.createElement("div");
    d.className = "kp" + (on ? " on" : ""); d.innerHTML = `<b>${on ? "✓" : "·"}</b>`; d.append(`${id}: ${k.label}`); $("kps").appendChild(d);
  }
  $("traps").innerHTML = cp.trapsSeen.length ? "" : '<span class="meta">none</span>';
  for (const t of cp.trapsSeen) { const p = document.createElement("span"); p.className = "pill trap"; p.textContent = `${t} ${cp.openTraps.includes(t) ? "open" : "cleared"}`; $("traps").appendChild(p); }
  if (events.length) $("last").textContent = events.map((e) => e.type + (e.id ? " " + e.id : e.name ? " → " + e.name : "")).join(", ");
  $("briefing").textContent = ck.briefing(cp);
  const r = rec.lastReport || {};
  $("evidence").textContent = (r.evidence || []).map((e) => `${e.id}: "${e.quote}"`).join("\n") || (AI_URL ? "none this turn" : "demo coach: no evidence quotes");
  $("sources").textContent = (r.sources || []).join(", ") || "none this turn";
}

// ---- coach --------------------------------------------------------------------------------
async function liveTurn(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(AI_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ messages: [...rec.ai.slice(-16), { role: "user", content: text }], briefing: ck.briefing(rec.checkpoint) }),
    });
    if (!res.ok) throw new Error("coach server " + res.status);
    const data = await res.json();
    if (typeof data.reply !== "string" || !data.report) throw new Error("bad reply");
    rec.ai.push({ role: "user", content: text }, { role: "assistant", content: data.reply });
    return data;
  } finally { clearTimeout(timer); }
}

async function turn(text) {
  let out;
  if (AI_URL) {
    try { out = await liveTurn(text); }
    catch (e) { console.warn("Live coach unavailable, using demo coach:", e); }
  }
  out ||= offlineTurn(journey, ck, rec.checkpoint, text);
  const { cp, events } = ck.applyTurn(rec.checkpoint, out.report);
  if (out.report.last_ask) cp.lastAsk = out.report.last_ask;
  rec.checkpoint = cp;
  let reply = out.reply;
  if (out.report.escalated && !/PHMAdvance|get back to you/i.test(reply)) reply += "\n\n" + escalationLine();
  if (events.some((e) => e.type === "handoff")) {
    reply += `\n\nIf it would help, the PHM Advance team is happy to talk this through with you directly. Some of these ideas land best in a conversation with a person. You can reach them at ${INBOX} (mention your learner ID, **${rec.id}**). And you're welcome to keep going here too.`;
  }
  if (events.some((e) => e.type === "trained")) {
    reply += `\n\nThat completes Stage 1 of the PHM Champion process: you're **PHM Trained**. Your learner ID is **${rec.id}**; keep it. ` +
      "Next, go back to your work, try the thing you named, then come back with your ID and tell me how it went. PHM Advance reviews that for certification and the Champion network.";
  }
  rec.lastReport = out.report;
  return { reply, escalated: Boolean(out.report.escalated), events };
}

// ---- flow ----------------------------------------------------------------------------------
function open(r, returning) {
  rec = r;
  $("start").hidden = true; $("chat").hidden = false;
  $("who").textContent = `Learner ID ${rec.id}` + (AI_URL ? "" : " · demo coach");
  if (returning && rec.msgs.length) {
    rec.msgs.forEach((m) => addMsg(m, false));
    const cp = rec.checkpoint;
    addMsg({ from: "coach", text: cp.outcome === "trained"
      ? `Welcome back. You're PHM Trained. Last time you said you'd try: "${cp.commitment}". How did it go? Tell me what you did, who was involved, and how it reached everyone it should.`
      : `Welcome back. We'll pick up where you left off: ${journey.stages[cp.stage].name}.` });
  } else {
    addMsg({ from: "coach", text: OPENING });
    rec.ai.push({ role: "user", content: "[The learner opened the PHM Coach.]" }, { role: "assistant", content: OPENING });
  }
  save(); renderProgress(); renderTeam(); $("t").focus();
}

async function init() {
  if (TEAM) { $("wrap").classList.add("team"); $("team").hidden = false; }
  journey = await (await fetch("journey.json")).json();
  ck = createCheckpoint(journey);
  const last = (() => { try { return localStorage.getItem(STORE + "last"); } catch { return null; } })();
  if (last && load(last)) $("code").value = last;

  $("new").onclick = () => open({ id: newId(), created: new Date().toISOString(), checkpoint: ck.newCheckpoint(), msgs: [], ai: [] }, false);
  $("resume").onclick = () => {
    const c = $("code").value.trim(), r = load(c);
    if (!/^\d{6}$/.test(c)) return ($("err").textContent = "Enter your six-digit learner ID.");
    if (!r) return ($("err").textContent = "That ID isn't saved in this browser yet. Start fresh, or use the browser you started in.");
    open(r, true);
  };
  $("f").onsubmit = async (e) => {
    e.preventDefault();
    const m = $("t").value.trim(); if (!m) return;
    addMsg({ from: "me", text: m.slice(0, 2000) }); $("t").value = ""; $("b").disabled = true;
    try {
      const o = await turn(m.slice(0, 2000));
      addMsg({ from: "coach", text: o.reply, esc: o.escalated });
      renderProgress(); renderTeam(o.events);
    } catch (err) { addMsg({ from: "coach", text: "Something went wrong: " + err.message, esc: true }); }
    finally { save(); $("b").disabled = false; $("t").focus(); }
  };
  $("t").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("f").requestSubmit(); } });
  $("sbtn").onclick = () => {
    const name = $("sname").value.trim(), blurb = $("sblurb").value.trim(), cp = rec.checkpoint;
    rec.shared = { name, blurb, at: new Date().toISOString() }; save();
    const body = [`Learner ID: ${rec.id}`, name && `Name: ${name}`, `Outcome: ${cp.outcome}`, `Role: ${cp.role}`,
      `What I said I'd try: ${cp.commitment || "-"}`, blurb && `\nWhat I did:\n${blurb}`].filter(Boolean).join("\n");
    location.href = `mailto:${INBOX}?subject=${encodeURIComponent(`PHM Coach: learner ${rec.id}`)}&body=${encodeURIComponent(body)}`;
  };
}
init();
