// Walks a scripted learner through the offline engine to make sure the whole journey is reachable.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { createCheckpoint } from "../docs/lib/checkpoint.js";
import { offlineTurn } from "../docs/lib/offline.js";

const journey = JSON.parse(readFileSync(new URL("../docs/journey.json", import.meta.url)));
const ck = createCheckpoint(journey);
const { newCheckpoint, applyTurn } = ck;

async function say(s, text) {
  const { reply, report } = offlineTurn(journey, ck, s.cp, text);
  const r = applyTurn(s.cp, report);
  if (report.last_ask) r.cp.lastAsk = report.last_ask;
  s.cp = r.cp;
  return { reply, report, events: r.events };
}

test("a scripted clinician reaches PHM Trained, after falling into and correcting the subgroup trap", async () => {
  const s = { history: [], cp: newCheckpoint() };
  await say(s, "Newmarket");
  assert.equal(s.cp.stage, 1);

  const t = await say(s, "Let's start with our diabetes patients and build a program for them.");
  assert.ok(s.cp.openTraps.includes("T1"));
  assert.match(t.reply, /Who is that group part of/);

  await say(s, "Fair, step back: everyone in Newmarket. Groups: seniors, people with diabetes, newcomers facing language barriers, families on low income.");
  await say(s, "Yes, my person fits more than one group, she's a senior with diabetes.");
  await say(s, "Population health is the outcome; PHM is how we organize to reach each person by name.");
  assert.equal(s.cp.stage, 2, `stage ${s.cp.stage}, heard ${s.cp.heard}`);

  await say(s, "Outcomes, experience, cost, care team well-being and equity can all improve with a mobile clinic.");
  await say(s, "Equity means targeted support according to need, not equal access.");
  assert.equal(s.cp.stage, 3);

  await say(s, "Who else is missing? The unattached people outside that group, we need everyone in the region.");
  await say(s, "I'd step back to everyone, not just the roster, and reach out earlier before a crisis.");
  assert.equal(s.cp.stage, 4);

  await say(s, "I'd tell my mom we ask her permission first, she can say no, and everyone gets basic prevention; housing and transport matter too.");
  assert.equal(s.cp.stage, 5, `stage ${s.cp.stage}, heard ${s.cp.heard}`);

  await say(s, "Population health is the outcome we want; PHM is the step by step cycle to get there for everyone.");
  const end = await say(s, "I will try asking about transport at every intake and flag it to our coordinator.");
  assert.equal(s.cp.outcome, "trained", `missing: heard=${s.cp.heard} traps=${s.cp.openTraps}`);
  assert.ok(end.events.some((e) => e.type === "trained"));
});

test("sensitive questions escalate instead of being answered", async () => {
  const s = { history: [], cp: newCheckpoint() };
  const r = await say(s, "Is this going to replace nurses with cheaper staff?");
  assert.equal(r.report.escalated, true);
  assert.match(r.reply, /PHMAdvance@southlake\.ca/);
});

test("the demo never blocks on wording: plain, informal answers move a learner on", async () => {
  const s = { history: [], cp: newCheckpoint() };
  await say(s, "i live up near keswick");
  assert.equal(s.cp.stage, 1);
  const r = await say(s, "lots of older folks, young families, people who cant get a family doctor");
  assert.ok(s.cp.heard.includes("S1-groups"), "informal groups answer counts");
  assert.match(r.reply, /Which group are they in|More than one/i, "next it asks the one-person question");
});

test("a question mid-journey is acknowledged, not credited", async () => {
  const s = { history: [], cp: newCheckpoint() };
  await say(s, "Aurora");
  const before = s.cp.heard.length;
  const r = await say(s, "wait what does segmentation mean?");
  assert.equal(s.cp.heard.length, before);
  assert.match(r.reply, /Good question/);
});

test("the one-person answer is credited as overlap, so the coach moves on to the next question", async () => {
  const s = { history: [], cp: newCheckpoint() };
  await say(s, "Bradford");
  await say(s, "older people living alone, families, folks with chronic conditions");
  const r = await say(s, "yeah my neighbour is probably in two of those");
  assert.ok(s.cp.heard.includes("S1-overlap"));
  assert.doesNotMatch(r.reply, /More than one\?/);
});

test("a short list counts as a real answer; filler does not", async () => {
  const s = { history: [], cp: newCheckpoint() };
  await say(s, "london, ontario");
  await say(s, "idk");
  assert.ok(!s.cp.heard.includes("S1-groups"));
  const r = await say(s, "children, neighbours, etc");
  assert.ok(s.cp.heard.includes("S1-groups"));
  assert.match(r.reply, /More than one/);
});
