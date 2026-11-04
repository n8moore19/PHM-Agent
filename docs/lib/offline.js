// Built-in demo coach, used until the live Claude worker is connected (and as a fallback
// if it is ever unreachable). It cannot read meaning: it catches a few traps by keyword
// and otherwise accepts any real answer, so it never blocks a learner. It shows the
// flow; the live coach is what judges understanding.

export const INBOX = "PHMAdvance@southlake.ca";
export const escalationLine = () =>
  `I don't have a grounded answer for that, and I'd rather not guess. I've passed your question to the PHM Advance team; you can also reach them at ${INBOX}.`;

const rx = {
  place: /[a-z]{3,}/i,
  groups: /(senior|older|diabet|heart|cardiac|mental|addict|unhoused|homeless|famil|parent|child|youth|teen|immigra|newcomer|income|poverty|language|disab|chronic|frail|copd|cancer)/gi,
  overlap: /\b(more than one|both|several|multiple|many of|overlap|yes)\b/i,
  population: /\b(everyone|everybody|whole (community|population|town|region)|all the people|entire|full population|all residents)\b/i,
  distinction: /(population health (is|=|means)|outcome).*(phm|management|process|how)|\b(what|goal)\b.*\b(how|process)\b/i,
  aims: /(outcome|experience|cost|well-?being|equity)/gi,
  equityNeed: /\b(need|targeted|not (the same|equal)|more because|according to need|fair)\b/i,
  cycle: /\b(step|cycle|loop|repeat|evaluat)/i,
  proactive: /\b(proactive|before (a )?crisis|earlier|prevent|upstream|reach out)\b/i,
  sdoh: /\b(housing|income|food|transport|social|determinant|isolat|alone|language)\b/i,
  stepback: /\b(everyone|whole population|step back|step 1|step one|who else|missing|left out|unattached|outside (that|the) group|all the people)\b/i,
  consent: /\b(permission|consent|say no|opt[ -]?out|ask (her|him|them) first)\b/i,
  everyoneGets: /\b(everyone gets|basic|all members|prevention|reminder|for everyone)\b/i,
  domains: /\b(domain|accountable|business model|data infrastructure|co-?design|analytics)\b/i,
  teachback: /population health.*(phm|management)|phm.*population health/i,
  commit: /\b(i will|i'll|i am going to|i'm going to|try|start by)\b/i,
  subgroupStart: /\b(start|begin|focus|program|let'?s do)\b.*\b(diabet|heart|cardiac|copd|cancer|senior|frail|homeless|unhoused)\b|\b(our|all (our|the)) (diabet|heart|copd|cancer|senior)/i,
  stepOneNeed: /step (one|1) (is|would be).*(need|problem|issue)/i,
  tradeoff: /\b(trade-?off|at the expense|can'?t (do|have) all|saves money so)\b/i,
  highestRisk: /\b(highest[- ]risk (first|people first)|always (start|focus) (with|on) the (highest|sickest))\b/i,
  sensitive: /\b(replace (us|nurses|staff)|cheaper staff|laid off|layoff|lawsuit|my licen[cs]e|grievance)\b/i,
};
const count = (re, t) => new Set((t.match(re) || []).map((m) => m.toLowerCase())).size;

function report(cp, t) {
  const heard = [], traps = [];
  const h = (id, ok) => ok && heard.push(id);
  if (cp.stage === 0) h("S0-place", rx.place.test(t));
  h("S1-groups", count(rx.groups, t) >= 2);
  h("S1-overlap", cp.stage >= 1 && rx.overlap.test(t) && cp.heard.includes("S1-groups"));
  h("L1-population", rx.population.test(t));
  h("L1-distinction", rx.distinction.test(t));
  h("L1-quintuple", count(rx.aims, t) >= 4);
  h("S2-equity-need", cp.stage >= 2 && /equit/i.test(t + (cp.lastAsk || "")) && rx.equityNeed.test(t));
  h("L1-cycle", rx.cycle.test(t) && cp.stage >= 1);
  h("L1-proactive", rx.proactive.test(t));
  h("L1-sdoh", rx.sdoh.test(t));
  h("S3-stepback", cp.stage === 3 && rx.stepback.test(t));
  h("L1-plain", cp.stage >= 4 && rx.consent.test(t));
  h("L2-everyone-gets", cp.stage >= 4 && rx.everyoneGets.test(t));
  h("L2-domains", cp.stage >= 4 && rx.domains.test(t));
  h("S5-teachback", cp.stage === 5 && rx.teachback.test(t));
  if (rx.subgroupStart.test(t) && !rx.population.test(t)) traps.push("T1");
  if (rx.stepOneNeed.test(t)) traps.push("T2");
  if (rx.tradeoff.test(t)) traps.push("T18");
  if (rx.highestRisk.test(t)) traps.push("T8");
  const num = t.match(/\b(10|[0-9])\b/);
  return {
    heard, traps_detected: traps,
    traps_cleared: cp.openTraps.filter((x) => (x === "T1" || x === "T2") && rx.population.test(t)),
    role: /\b(chart|vitals|handoff|floated|my patients?|unit|clinic)\b/i.test(t) ? "clinician"
      : /\b(budget|fte|program manager|director|admin)\b/i.test(t) ? "administrator"
      : /\bvolunteer\b/i.test(t) ? "volunteer" : "unknown",
    confidence: cp.stage === 0 && num ? Number(num[1]) : -1,
    commitment: cp.stage === 5 && rx.commit.test(t) && t.length > 25 ? t.slice(0, 140) : "",
    test_used: "", gap_probed: "",
  };
}

const words = (t) => (t.trim().match(/\S+/g) || []).length;

/** One demo turn. ck is the object from createCheckpoint; cp is the current checkpoint. */
export function offlineTurn(journey, ck, cp, text) {
  const { applyTurn } = ck;
  if (rx.sensitive.test(text)) {
    return { reply: `That's a real concern, and an important one to name. ${escalationLine()}`,
      report: { heard: [], traps_detected: [], traps_cleared: [], escalated: true, escalation_reason: "Sensitive topic", question_summary: text.slice(0, 300) } };
  }
  const r = report(cp, text);
  const trap = r.traps_detected[0] && journey.traps.find((x) => x.id === r.traps_detected[0]);
  if (trap) {
    r.gap_probed = trap.id;
    return { reply: `Good instinct to get specific. I'd challenge you on one thing, though. ${trap.probe}`, report: r };
  }
  const ask = (cp.lastAsk || "").replace(/\s*\([^)]*\)\s*$/, "");
  if (/\?\s*$/.test(text) && cp.stage > 0) {
    return { reply: `Good question. The full coach answers questions like that from Southlake's PHM materials; this demo can't, so I've noted it.${ask ? ` Coming back to where we were: ${ask}` : ""}`, report: r };
  }
  // Leniency: a real answer counts for the point the current question is after.
  const target = ck.missingForStage(cp)[0]?.replace(/\s*\(.*\)$/, "");
  const stageHeard = r.heard.some((id) => ck.missingForStage(cp).some((m) => m.startsWith(id)));
  // A real answer: a list ("children, neighbours, etc") or a few words; not filler like "hmm" or "idk".
  const filler = /^\s*(hmm+|idk|dunno|not sure|ok(ay)?|maybe|yes|no|yeah|nope|\?+)\s*[.!?]*\s*$/i.test(text);
  const real = !filler && (cp.stage === 0 || words(text) >= 3 || /[,;\n]/.test(text));
  if (target && !stageHeard && real) r.heard.push(target);
  // Pick the next move from the state this turn will produce.
  const { cp: next } = applyTurn(cp, r);
  const s = journey.stages[next.stage];
  let move;
  if (next.stage === 3) {
    const t = s.tests.find((x) => !next.testsUsed.includes(x.id) && (!x.roles || x.roles.includes(next.role)));
    move = t ? t.say : s.standard_move;
    r.test_used = t?.id || "";
  } else if (next.stage === 1 && !next.heard.includes("S1-groups")) {
    move = s.agent_moves[0];
  } else if (next.stage === 1 && !next.heard.includes("S1-overlap")) {
    move = s.agent_moves[1]; // the aha: which group is your one person in?
  } else {
    move = s.agent_moves[Math.min(next.stage === 1 ? Math.max(2, next.stageTurns) : next.stageTurns, s.agent_moves.length - 1)];
  }
  let affirm = cp.stage === 0 ? "Great, let's use that place. "
    : r.heard.length ? "That's a strong answer, and you got there yourself. " : "Thanks, that helps me see where you're coming from. ";
  if (cp.stage === 1 && next.stage === 2) affirm += journey.stages[1].reveal + " ";
  // Show a diagram at the moments the full coach would: the overlap aha, the reveal,
  // the Quintuple Aim recap and the California walk-through.
  r.visual = !cp.heard.includes("S1-overlap") && next.heard.includes("S1-overlap") ? "groups"
    : cp.stage === 1 && next.stage === 2 ? "cycle"
    : cp.stage === 2 && next.stage === 3 ? "quintuple"
    : cp.stage === 3 && next.stage === 4 ? (["administrator", "leader"].includes(next.role) ? "domains" : "california") : "";
  r.last_ask = move;
  return { reply: affirm + move.replace(/\s*\([^)]*\)\s*$/, ""), report: r };
}
