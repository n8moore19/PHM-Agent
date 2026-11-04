import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCheckpoint } from "../docs/lib/checkpoint.js";

const journey = JSON.parse(readFileSync(new URL("../docs/journey.json", import.meta.url)));
const { newCheckpoint, applyTurn, probeMode, missingLevel1, briefing } = createCheckpoint(journey);

const turn = (cp, r) => applyTurn(cp, { heard: [], traps_detected: [], traps_cleared: [], ...r });

test("stage 0 advances once a place is named", () => {
  const { cp, events } = turn(newCheckpoint(), { heard: ["S0-place"] });
  assert.equal(cp.stage, 1);
  assert.ok(events.some((e) => e.type === "stage" && e.stage === 1));
});

test("stage 0 always moves on after max turns", () => {
  let cp = newCheckpoint();
  for (let i = 0; i < journey.stages[0].max_turns; i++) cp = turn(cp, {}).cp;
  assert.equal(cp.stage, 1);
});

test("a strong learner can clear several stages in one turn, but never skips stage 3's step-backs", () => {
  let { cp } = turn(newCheckpoint(), { heard: ["S0-place", "S1-groups", "S1-overlap", "L1-population", "L1-distinction", "L1-quintuple", "S2-equity-need"] });
  assert.equal(cp.stage, 3);
  ({ cp } = turn(cp, { heard: ["S3-stepback"] }));
  assert.equal(cp.stage, 3, "one step-back is not enough");
  ({ cp } = turn(cp, { heard: ["S3-stepback"] }));
  assert.equal(cp.stage, 4);
});

test("key points and stages never go backwards", () => {
  let { cp } = turn(newCheckpoint(), { heard: ["S0-place", "L1-population"] });
  ({ cp } = turn(cp, { heard: [] }));
  assert.ok(cp.heard.includes("L1-population"));
  assert.equal(cp.stage, 1);
});

test("unknown ids from the model are ignored", () => {
  const { cp } = turn(newCheckpoint(), { heard: ["made-up"], traps_detected: ["T99"] });
  assert.deepEqual(cp.heard, []);
  assert.deepEqual(cp.openTraps, []);
});

test("traps open and clear; probe count escalates to scenario then explanation", () => {
  let { cp } = turn(newCheckpoint(), { traps_detected: ["T1"], gap_probed: "T1" });
  assert.deepEqual(cp.openTraps, ["T1"]);
  ({ cp } = turn(cp, { gap_probed: "T1" }));
  ({ cp } = turn(cp, { gap_probed: "T1" }));
  assert.equal(probeMode(cp), "fresh_scenario");
  ({ cp } = turn(cp, { gap_probed: "T1" }));
  assert.equal(probeMode(cp), "explain_then_apply");
  ({ cp } = turn(cp, { traps_cleared: ["T1"], gap_probed: "T1" }));
  assert.deepEqual(cp.openTraps, []);
  assert.equal(cp.probe.count, 0);
});

test("trained needs every Level 1 point, no open central trap, and a commitment", () => {
  const all = ["S0-place", "S1-groups", "S1-overlap", "L1-population", "L1-distinction", "L1-quintuple", "S2-equity-need",
    "L1-cycle", "L1-proactive", "L1-sdoh", "L1-plain", "L2-everyone-gets", "S5-teachback"];
  let { cp } = turn(newCheckpoint(), { heard: all.filter((x) => x !== "L1-sdoh"), role: "clinician" });
  ({ cp } = turn(cp, { heard: ["S3-stepback"] }));
  ({ cp } = turn(cp, { heard: ["S3-stepback"], traps_detected: ["T5"] }));
  ({ cp } = turn(cp, { commitment: "Ask about transport at intake" }));
  assert.equal(cp.stage, 5);
  assert.equal(cp.outcome, "not_yet", "missing L1-sdoh and T5 open");
  assert.deepEqual(missingLevel1(cp), ["L1-sdoh"]);
  ({ cp } = turn(cp, { heard: ["L1-sdoh"] }));
  assert.equal(cp.outcome, "not_yet", "T5 still open");
  const r = turn(cp, { traps_cleared: ["T5"] });
  assert.equal(r.cp.outcome, "trained");
  assert.ok(r.events.some((e) => e.type === "trained"));
});

test("role-specific exit: administrators need the domains point in stage 4", () => {
  let { cp } = turn(newCheckpoint(), { heard: ["S0-place", "S1-groups", "S1-overlap", "L1-population", "L1-distinction", "L1-quintuple", "S2-equity-need", "S3-stepback"], role: "administrator" });
  ({ cp } = turn(cp, { heard: ["S3-stepback", "L1-plain"] }));
  assert.equal(cp.stage, 4);
  ({ cp } = turn(cp, { heard: ["L2-domains"] }));
  assert.equal(cp.stage, 5);
});

test("briefing never mentions awarding and names the current gap", () => {
  const { cp } = turn(newCheckpoint(), { traps_detected: ["T1"], gap_probed: "T1" });
  const b = briefing(cp);
  assert.match(b, /Open traps: T1/);
  assert.match(b, /Current gap: T1/);
});
