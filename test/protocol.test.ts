import assert from "node:assert/strict";
import { test } from "node:test";
import { PROTOCOL_RULES } from "../runner/engine";
import { deploymentProblems, loadProtocol, LOCKED } from "../runner/protocol";
import { FEE_BPS } from "../src/market";
import { ALPHA } from "../src/stats";

const p = loadProtocol();
const full = { name: "experiment-177", rules: PROTOCOL_RULES, main: 6, shuffled: 6, coin: "HYPE", nodeVersion: `v${p.node}` };

test("the protocol file and the code state the same rules", () => {
  assert.equal(p.populations.selection, PROTOCOL_RULES.selectionSize);
  assert.equal(p.populations.control, PROTOCOL_RULES.controlSize);
  assert.equal(p.generations, PROTOCOL_RULES.generations);
  assert.equal(p.hoursPerGeneration, PROTOCOL_RULES.hoursPerGeneration);
  assert.equal(p.holdoutHours, PROTOCOL_RULES.holdoutHours);
  assert.equal(p.test.alpha, ALPHA);
  assert.equal(p.feeBps, FEE_BPS);
  assert.ok(p.seed.length > 0);
});

test("an unlocked protocol cannot be deployed as the experiment", () => {
  assert.equal(p.status === LOCKED, false, "update this test when the protocol is locked");
  assert.match(deploymentProblems(full, p).join(), /kilitli değil/);
});

test("a locked deployment must match the protocol exactly", () => {
  const locked = { ...p, status: LOCKED };
  assert.deepEqual(deploymentProblems(full, locked), []);
  assert.match(deploymentProblems({ ...full, main: 5 }, locked).join(), /Ana tekrar/);
  assert.match(deploymentProblems({ ...full, rules: { ...PROTOCOL_RULES, holdoutHours: 168 } }, locked).join(), /Görülmemiş dönem/);
  assert.match(deploymentProblems({ ...full, coin: "BTC" }, locked).join(), /Piyasa/);
  assert.match(deploymentProblems({ ...full, seed: "another" }, locked).join(), /Tohum/);
});

test("test deployments may be small but still need the pinned Node", () => {
  const small = { ...full, name: "test-2", main: 1, shuffled: 0, rules: { ...PROTOCOL_RULES, generations: 2, holdoutHours: 6 } };
  assert.deepEqual(deploymentProblems(small, p), []);
  assert.match(deploymentProblems({ ...small, nodeVersion: "v24.0.0" }, p).join(), /Node/);
});
