// PHM Coach, browser app. Holds the learner's checkpoint, talks to the live coach
// (Cloudflare Worker) when configured, and falls back to the built-in demo coach.
import { createCheckpoint } from "./lib/checkpoint.js?v=7";
import { offlineTurn, escalationLine, INBOX } from "./lib/offline.js?v=7";
import { renderVisual } from "./lib/visuals.js?v=7";

const $ = (id) => document.getElementById(id);
const TEAM = new URLSearchParams(location.search).has("team");
// ?ai=<url> points the page at a different coach (e.g. a local worker) for testing.
const AI_URL = (new URLSearchParams(location.search).get("ai") || window.PHM_AI_URL || "").trim();
const STORE = "phm-coach:";
const TRAINED = "PHM Trained"; // the name of the Stage 1 outcome, in one place

const OPENING = "Hi! I'm the PHM Coach, Southlake's conversational trainer for Population Health Management. We'll learn by working through a few real situations together, and there are no wrong answers. Before we get into any frameworks: think about where you live, and one other person who lives there. Where is it?";

let journey, ck, rec; // rec = { id, created, checkpoint, msgs:[{from,text,esc}], ai:[{role,content}], shared }

// ---- storage: the coach server keeps each ID's conversation (so it works on any device);
// this browser keeps a copy too, in case the server can't be reached. ----------------------
const base = () => AI_URL.replace(/\/+$/, "");
const load = (id) => { try { return JSON.parse(localStorage.getItem(STORE + id)); } catch { return null; } };
async function loadRemote(id) {
  if (!AI_URL) return null;
  try {
    const res = await fetch(base() + "/session/load", { signal: AbortSignal.timeout(8000), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ learnerId: id }) });
    return res.ok ? (await res.json()).record : null;
  } catch { return null; }
}
let remoteTimer;
function save() {
  rec.updated = new Date().toISOString();
  try { localStorage.setItem(STORE + rec.id, JSON.stringify(rec)); localStorage.setItem(STORE + "last", rec.id); } catch {}
  if (!AI_URL) return;
  clearTimeout(remoteTimer);
  const snapshot = JSON.stringify({ learnerId: rec.id, record: { ...rec, ai: rec.ai.slice(-40) } });
  remoteTimer = setTimeout(() => fetch(base() + "/session/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: snapshot, keepalive: true }).catch(() => {}), 300);
}

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
  d.className = `msg ${m.from}${m.esc ? " escalated" : ""}${m.welcome ? " welcome" : ""}`;
  d.innerHTML = m.from === "coach" ? format(m.text) : `<p>${esc(m.text)}</p>`;
  if (m.visual) { const v = renderVisual(m.visual, m.vh); if (v) { const fig = document.createElement("figure"); fig.className = "fig"; fig.innerHTML = v; d.appendChild(fig); } }
  if (m.esc) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "Passed to the PHM Advance team"; d.appendChild(t); }
  $("log").appendChild(d); $("log").scrollTop = 1e9;
  if (store) rec.msgs.push(m);
}
function renderProgress() {
  const cp = rec.checkpoint;
  $("share").hidden = cp.outcome !== "trained";
  // Learners see a progress bar (never the checkpoint itself); the team view adds the stage track.
  const p = ck.progress(cp);
  $("prog").hidden = false;
  $("progFill").style.width = p.pct + "%";
  $("progBar").setAttribute("aria-valuenow", p.pct);
  $("progLabel").textContent = cp.outcome === "trained" ? `Complete · ${TRAINED}` : `Part ${p.step} of ${p.of}: ${p.label}`;
  $("progPct").textContent = p.pct + "%";
  $("prog").classList.toggle("stuck", p.stuck);
  $("progHint").hidden = !p.stuck;
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
  t.textContent = cp.outcome === "trained" ? `${TRAINED} ✓` : TRAINED;
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

// ---- records for the PHM Advance team: learner ID only, never a name -------------------
async function postRecord(type, data = {}) {
  if (!AI_URL) return false;
  try {
    const res = await fetch(base() + "/record", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ learnerId: rec.id, type, data }) });
    return res.ok;
  } catch { return false; }
}

// ---- celebration --------------------------------------------------------------------------
function celebrate() {
  $("cId").textContent = rec.id;
  $("cShare").textContent = "Sharing your learner ID with Southlake's PHM Advance team…";
  $("celebrate").hidden = false; $("cClose").focus();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const box = $("confetti"); box.innerHTML = "";
    const colors = ["#00a3e0", "#0067b1", "#22c55e", "#facc15", "#7dd3fc", "#ffffff"];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement("i");
      c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.8}s;animation-duration:${2.4 + Math.random() * 1.8}s;transform:rotate(${Math.random() * 360}deg)`;
      box.appendChild(c);
    }
  }
  const cp = rec.checkpoint;
  postRecord("trained", { role: cp.role, stage: cp.stage, commitment: cp.commitment || "", heard: cp.heard, traps: cp.trapsSeen }).then((ok) => {
    rec.reported = ok; save();
    $("cShare").innerHTML = ok
      ? `Your learner ID <b>${rec.id}</b> has been shared with Southlake's PHM Advance team, so they know this ID completed Stage 1.`
      : `We couldn't reach the PHM Advance team automatically. Please email <b>${INBOX}</b> with your learner ID <b>${rec.id}</b> so they know you've completed Stage 1.`;
  });
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
  const r = out.report;
  if (r.escalated) postRecord("escalation", { stage: cp.stage, role: cp.role, question: r.question_summary || r.escalation_reason || "" });
  if (out.report.escalated && !/PHMAdvance|get back to you/i.test(reply)) reply += "\n\n" + escalationLine();
  if (events.some((e) => e.type === "handoff")) {
    postRecord("handoff", { stage: cp.stage, role: cp.role });
    reply += `\n\nIf it would help, the PHM Advance team is happy to talk this through with you directly. Some of these ideas land best in a conversation with a person. You can reach them at ${INBOX} (mention your learner ID, **${rec.id}**). And you're welcome to keep going here too.`;
  }
  if (events.some((e) => e.type === "trained")) {
    reply += `\n\nThat completes Stage 1 of the PHM Champion process: you're **${TRAINED}**. Your learner ID is **${rec.id}**; keep it. ` +
      "Southlake's PHM Advance team will reach out with next steps for the Champion process, where you put this into practice. In the meantime, try the thing you named and come back with your ID to tell me how it went.";
  }
  rec.lastReport = out.report;
  const visual = typeof r.visual === "string" ? r.visual : "";
  return { reply, escalated: Boolean(r.escalated), events, visual, vh: Number(r.visual_highlight) || 0 };
}

// ---- flow ----------------------------------------------------------------------------------
function open(r, returning) {
  rec = r;
  $("start").hidden = true; $("app").hidden = false; $("log").innerHTML = "";
  $("who").textContent = `ID ${rec.id}` + (AI_URL ? "" : " · demo");
  if (returning && rec.msgs.length) {
    rec.msgs.forEach((m) => addMsg(m, false));
    const cp = rec.checkpoint;
    addMsg({ from: "coach", text: cp.outcome === "trained"
      ? `Welcome back. You're ${TRAINED}. Last time you said you'd try: "${cp.commitment}". How did it go? Tell me what you did, who was involved, and how it reached everyone it should.`
      : "Welcome back! Your conversation is saved above. Pick up with the last question whenever you're ready, or ask me anything.", welcome: true }, false);
  } else {
    addMsg({ from: "coach", text: OPENING });
    rec.ai.push({ role: "user", content: "[The learner opened the PHM Coach.]" }, { role: "assistant", content: OPENING });
  }
  save(); renderProgress(); renderTeam(); $("t").focus();
}

async function init() {
  if (TEAM) { $("wrap").classList.add("team"); $("team").hidden = false; }
  journey = await (await fetch("journey.json?v=7")).json();
  ck = createCheckpoint(journey);
  const last = (() => { try { return localStorage.getItem(STORE + "last"); } catch { return null; } })();
  if (last && /^\d{6}$/.test(last)) $("code").value = last;

  // Sign in with any six-digit ID: a known ID picks up where it left off, a new one starts fresh.
  $("code").addEventListener("input", () => { $("code").value = $("code").value.replace(/\D/g, "").slice(0, 6); $("err").textContent = ""; });
  $("login").onsubmit = async (e) => {
    e.preventDefault();
    const id = $("code").value.trim();
    if (!/^\d{6}$/.test(id)) return ($("err").textContent = "Enter a six-digit number.");
    $("go").disabled = true; $("go").textContent = "Opening…";
    try {
      const local = load(id), remote = await loadRemote(id);
      const r = [remote, local].filter((x) => x && x.checkpoint && Array.isArray(x.msgs)).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""))[0];
      if (r?.msgs.length) open({ ai: [], ...r, id, checkpoint: { ...ck.newCheckpoint(), ...r.checkpoint } }, true);
      else open({ id, created: new Date().toISOString(), checkpoint: ck.newCheckpoint(), msgs: [], ai: [] }, false);
    } catch (err) {
      console.error(err);
      $("err").textContent = "Something went wrong opening that ID. Refresh the page and try again.";
      $("app").hidden = true; $("start").hidden = false;
    } finally { $("go").disabled = false; $("go").textContent = "Continue"; }
  };
  $("switch").onclick = () => {
    clearTimeout(remoteTimer); if (rec) save();
    $("app").hidden = true; $("start").hidden = false; $("celebrate").hidden = true; $("code").value = ""; $("code").focus();
  };
  $("f").onsubmit = async (e) => {
    e.preventDefault();
    const m = $("t").value.trim(); if (!m) return;
    addMsg({ from: "me", text: m.slice(0, 2000) }); $("t").value = ""; $("b").disabled = true;
    const typing = document.createElement("div"); typing.className = "msg coach typing"; typing.innerHTML = "<i></i><i></i><i></i>";
    $("log").appendChild(typing); $("log").scrollTop = 1e9;
    try {
      const o = await turn(m.slice(0, 2000));
      addMsg({ from: "coach", text: o.reply, esc: o.escalated, ...(o.visual ? { visual: o.visual, vh: o.vh } : {}) });
      renderProgress(); renderTeam(o.events);
      if (o.events.some((e) => e.type === "trained")) celebrate();
    } catch (err) { typing.remove(); addMsg({ from: "coach", text: "Something went wrong: " + err.message, esc: true }); }
    finally { typing.remove(); save(); $("b").disabled = false; $("t").focus(); }
  };
  $("t").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("f").requestSubmit(); } });
  $("cClose").onclick = () => { $("celebrate").hidden = true; $("t").focus(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("celebrate").hidden) $("cClose").click(); });
  // Share what they tried, by learner ID only. Falls back to email if the server can't be reached.
  $("sbtn").onclick = async () => {
    const blurb = $("sblurb").value.trim(), cp = rec.checkpoint;
    if (!blurb) return ($("smsg").textContent = "Add a few lines about what you tried first.");
    $("sbtn").disabled = true;
    const ok = await postRecord("writeup", { role: cp.role, stage: cp.stage, commitment: cp.commitment || "", text: blurb });
    $("sbtn").disabled = false;
    rec.shared = { blurb, at: new Date().toISOString(), sent: ok }; save();
    if (ok) return ($("smsg").textContent = `Sent to PHM Advance under learner ID ${rec.id}. Thank you.`);
    const body = [`Learner ID: ${rec.id}`, `Role: ${cp.role}`, `What I said I'd try: ${cp.commitment || "-"}`, `\nWhat I did:\n${blurb}`].join("\n");
    location.href = `mailto:${INBOX}?subject=${encodeURIComponent(`PHM Coach: learner ${rec.id}`)}&body=${encodeURIComponent(body)}`;
  };
}
init();
