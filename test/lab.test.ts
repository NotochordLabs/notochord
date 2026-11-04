import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConnectome } from "../src/connectome";
import { layoutFor, randomGenome } from "../src/genome";
import { detectRoles } from "../src/roles";
import { syntheticMarket } from "../src/market";
import { Rng } from "../src/rng";
import { LAB_RACE_HOURS, labChild, labGenomeHash, labRace } from "../lab/core";

const connectome = loadConnectome("data/connectome");
const layout = layoutFor(connectome);
const roles = detectRoles(connectome);
const rng = new Rng("lab-test");
const a = randomGenome(layout, rng);
const b = randomGenome(layout, rng);
const R = "0x" + "ab".repeat(32);

test("a child is fixed by its id and the drand randomness", () => {
  assert.deepEqual(labChild(a, b, 7, R), labChild(a, b, 7, R));
  assert.deepEqual(labChild(a, b, 7, R), labChild(a, b, 7, R.toUpperCase().replace("0X", "0x")));
  assert.notDeepEqual(labChild(a, b, 7, R), labChild(a, b, 8, R));
  assert.notDeepEqual(labChild(a, b, 7, R), labChild(a, b, 7, "0x" + "cd".repeat(32)));
});

test("a child's genes come from its parents, apart from about 1% mutations", () => {
  const child = labChild(a, b, 1, R);
  assert.equal(child.length, layout.size);
  let foreign = 0;
  for (let i = 0; i < child.length; i++) if (child[i] !== a[i] && child[i] !== b[i]) foreign++;
  assert.ok(foreign / child.length < 0.02, `${foreign} genes from neither parent`);
  assert.match(labGenomeHash(child), /^0x[0-9a-f]{64}$/);
});

test("parent order matters and is the order recorded on chain", () => {
  assert.notDeepEqual(labChild(a, b, 3, R), labChild(b, a, 3, R));
});

test("a race scores 24 hours with the experiment's fitness rule", () => {
  const market = syntheticMarket(24 * 6);
  const race = labRace(connectome, layout, roles, labChild(a, b, 1, R), market, 48);
  assert.equal(race.decisions.length, LAB_RACE_HOURS);
  assert.ok(race.decisions.every((d) => d === 0 || d === 1 || d === 2));
  assert.equal(race.fitness, race.pnl - (race.maxDrawdown >> 1));
  assert.match(race.decisionsHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(race, labRace(connectome, layout, roles, labChild(a, b, 1, R), market, 48));
});

test("genomes of different sizes cannot be bred", () => {
  assert.throws(() => labChild(a, b.subarray(0, 10), 1, R));
});
