// The background checkpoint: per-learner state that only moves forward.
// The coach reports what it heard each turn; this code decides stage, probes and outcome.
// Pure module (no I/O) so it runs in the browser, in the tests and anywhere else.

export const ROLES = ["clinician", "administrator", "leader", "volunteer", "other", "unknown"];

export function createCheckpoint(journey) {
  const KEY_IDS = Object.keys(journey.key_points);
  const TRAP_IDS = journey.traps.map((t) => t.id);
  const LAST_STAGE = journey.stages.length - 1;

  const newCheckpoint = () => ({
    stage: 0, stageTurns: 0,
    heard: [],          // key point ids, never removed
    stepbacks: 0,       // Stage 3 perspective tests passed
    testsUsed: [],
    openTraps: [], trapsSeen: [],
    probe: { gap: null, count: 0 },
    role: "unknown", confidence: null, commitment: null,
    outcome: "not_yet", // not_yet | trained
    escalations: 0,
    stuck: 0,           // turns in this stage with nothing new heard
    handoffs: [],       // stages where the PHM Advance handoff was offered
  });

  const has = (cp, id) => cp.heard.includes(id);

  function stageExitMet(cp, stage) {
    const s = journey.stages[stage];
    if (stage === 0 && cp.stageTurns >= s.max_turns) return true; // "always moves on"
    if (!s.exit_all.every((id) => has(cp, id))) return false;
    if (s.exit_stepbacks && cp.stepbacks < journey.stepbacks_needed) return false;
    const byRole = s.exit_by_role?.[cp.role];
    return !byRole || byRole.every((id) => has(cp, id));
  }

  function missingForStage(cp, stage = cp.stage) {
    const s = journey.stages[stage];
    const need = [...s.exit_all, ...(s.exit_by_role?.[cp.role] || [])].filter((id) => !has(cp, id));
    if (s.exit_stepbacks && cp.stepbacks < journey.stepbacks_needed) need.push(`S3-stepback (${cp.stepbacks}/${journey.stepbacks_needed})`);
    return need;
  }

  const missingLevel1 = (cp) => journey.level1.filter((id) => !has(cp, id));
  const openCentral = (cp) => cp.openTraps.filter((t) => journey.central_traps.includes(t));
  const trainedReady = (cp) => missingLevel1(cp).length === 0 && openCentral(cp).length === 0 && Boolean(cp.commitment);

  function probeMode(cp) {
    if (!cp.probe.gap || cp.probe.count < journey.probe_limit) return "probe";
    if (cp.probe.count === journey.probe_limit) return "fresh_scenario";
    return "explain_then_apply";
  }

  /** Apply one turn's report. Returns { cp, events } (events: heard, trap, trap_cleared, stage, trained). */
  function applyTurn(prev, report) {
    const cp = structuredClone({ stuck: 0, handoffs: [], ...prev });
    const events = [];
    cp.stageTurns += 1;

    for (const id of report.heard || []) {
      if (!KEY_IDS.includes(id)) continue;
      if (id === "S3-stepback") { cp.stepbacks += 1; events.push({ type: "stepback", n: cp.stepbacks }); }
      if (!has(cp, id)) { cp.heard.push(id); events.push({ type: "heard", id }); }
    }
    for (const t of report.traps_detected || []) {
      if (!TRAP_IDS.includes(t)) continue;
      if (!cp.openTraps.includes(t)) { cp.openTraps.push(t); events.push({ type: "trap", id: t }); }
      if (!cp.trapsSeen.includes(t)) cp.trapsSeen.push(t);
    }
    for (const t of report.traps_cleared || []) {
      if (cp.openTraps.includes(t)) { cp.openTraps = cp.openTraps.filter((x) => x !== t); events.push({ type: "trap_cleared", id: t }); }
    }
    if (report.test_used && !cp.testsUsed.includes(report.test_used)) cp.testsUsed.push(report.test_used);
    if (report.role && report.role !== "unknown" && ROLES.includes(report.role)) cp.role = report.role;
    if (Number.isFinite(report.confidence) && report.confidence >= 0 && cp.confidence === null) cp.confidence = report.confidence;
    if (report.commitment && !cp.commitment) { cp.commitment = report.commitment; if (!has(cp, "S5-commitment")) cp.heard.push("S5-commitment"); }

    // Probe accounting: same open gap again => count up; closed or changed => reset.
    const gap = report.gap_probed || null;
    const closed = gap && (has(cp, gap) || (TRAP_IDS.includes(gap) && !cp.openTraps.includes(gap)));
    if (!gap || closed) cp.probe = { gap: null, count: 0 };
    else if (gap === cp.probe.gap) cp.probe.count += 1;
    else cp.probe = { gap, count: 1 };

    // Stuck accounting: a turn with nothing new heard counts toward the handoff.
    cp.stuck = events.some((e) => e.type === "heard" || e.type === "stepback" || e.type === "trap_cleared") ? 0 : cp.stuck + 1;

    // Advance as far as exits allow (a fast learner can clear several stages in one turn).
    while (cp.stage < LAST_STAGE && stageExitMet(cp, cp.stage)) {
      cp.stage += 1; cp.stageTurns = 0;
      // A stage gap resets with the stage; an open trap keeps its probe count.
      if (!(cp.probe.gap && cp.openTraps.includes(cp.probe.gap))) cp.probe = { gap: null, count: 0 };
      cp.stuck = 0;
      events.push({ type: "stage", stage: cp.stage, name: journey.stages[cp.stage].name });
    }
    // Offer the PHM Advance handoff once per stage when the learner is stuck.
    const exhausted = cp.probe.gap && cp.probe.count > journey.probe_limit + 1;
    if (cp.outcome === "not_yet" && !cp.handoffs.includes(cp.stage) && (exhausted || cp.stuck >= (journey.handoff_after_turns || 6))) {
      cp.handoffs.push(cp.stage);
      events.push({ type: "handoff", stage: cp.stage });
    }
    if (cp.outcome === "not_yet" && cp.stage === LAST_STAGE && stageExitMet(cp, LAST_STAGE) && trainedReady(cp)) {
      cp.outcome = "trained";
      events.push({ type: "trained" });
    }
    if (report.escalated) cp.escalations += 1;
    return { cp, events };
  }

  /** The per-turn briefing the coach reads, appended after the learner's words. */
  function briefing(cp) {
    const s = journey.stages[cp.stage];
    const lines = [
      `Stage ${cp.stage}: ${s.name}. Goal: ${s.goal}`,
      `Still to hear in this stage: ${missingForStage(cp).join(", ") || "nothing; this stage is complete"}.`,
      `Level 1 still missing overall: ${missingLevel1(cp).join(", ") || "none"}.`,
      `Open traps: ${cp.openTraps.join(", ") || "none"}.`,
      `Role: ${cp.role}.${cp.confidence !== null ? ` Starting confidence: ${cp.confidence}/10.` : ""}`,
    ];
    if (cp.stuck >= (journey.handoff_after_turns || 6) - 2 && !cp.handoffs.includes(cp.stage))
      lines.push(`The learner has gone ${cp.stuck} turns without new progress here. Try a different angle or a simpler scenario; the app will offer the PHM Advance handoff soon if this continues.`);
    if (cp.handoffs.includes(cp.stage)) lines.push("The PHM Advance handoff has been offered in this stage. Keep coaching warmly if they continue; don't repeat the offer.");
    if (cp.stage === 3) lines.push(`Perspective tests already used: ${cp.testsUsed.join(", ") || "none"}. Step-backs so far: ${cp.stepbacks}/${journey.stepbacks_needed}.`);
    if (cp.probe.gap) {
      const mode = probeMode(cp);
      lines.push(`Current gap: ${cp.probe.gap}, probed ${cp.probe.count} time(s). Next move: ${
        mode === "probe" ? "probe again from a new angle (one question)."
        : mode === "fresh_scenario" ? "give a fresh scenario that makes the gap obvious."
        : "explain it directly in two sentences from the Definitions Library, then ask them to apply it."}`);
    }
    if (cp.outcome === "trained") lines.push("Outcome: PHM Trained already awarded (the app announced it). Answer questions and tie them back to everyone. If the learner describes something they tried at work, help them shape a short Certified blurb (what they did, who was involved, how it reached the whole population, what they learned), then tell them to use the 'Share with PHM Advance' button. PHM Advance decides certification, never you.");
    else if (cp.stage === LAST_STAGE) lines.push("PHM Trained is awarded by the app, never by you. Do not say the learner is trained or certified.");
    return lines.join("\n");
  }

  return { KEY_IDS, TRAP_IDS, ROLES, newCheckpoint, applyTurn, briefing, missingLevel1, missingForStage, probeMode, trainedReady };
}
