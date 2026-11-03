import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/rng";
import { syntheticConnectome, buildConnectome } from "../src/connectome";
import { crossover, genomeHash, layoutFor, mutate, randomGenome } from "../src/genome";
import { express, Scratch, think } from "../src/brain";
import { detectRoles } from "../src/roles";
import { syntheticMarket } from "../src/market";
import { DEFAULTS, runExperiment } from "../src/experiment";
import { parseCsv } from "../src/csv";
import { signFlipTest } from "../src/stats";

test("rng is deterministic per seed", () => {
  const a = new Rng("x");
  const b = new Rng("x");
  const c = new Rng("y");
  const sa = Array.from({ length: 5 }, () => a.u32());
  assert.deepEqual(sa, Array.from({ length: 5 }, () => b.u32()));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, () => c.u32()));
});

test("csv parser handles quotes and the Netzschleuder header", () => {
  const rows = parseCsv('# index, name, _pos\n0,MN1L,"array([1.0, 2.0])"\n1,"pr, I",x\n');
  assert.deepEqual(rows[1], ["0", "MN1L", "array([1.0, 2.0])"]);
  assert.equal(rows[2][1], "pr, I");
});

test("connectome builds CSR and merges duplicate edges", () => {
  const c = buildConnectome(["a", "b", "c"], [{ s: 0, t: 1, w: 1 }, { s: 0, t: 1, w: 1 }, { s: 2, t: 0, w: 0.5 }], "t", true);
  assert.equal(c.edgeSrc.length, 2);
  assert.deepEqual([...c.rowPtr], [0, 1, 1, 2]);
});

test("crossover takes genes only from parents; mutation stays in range", () => {
  const c = syntheticConnectome();
  const layout = layoutFor(c);
  const rng = new Rng("g");
  const a = randomGenome(layout, rng);
  const b = randomGenome(layout, rng);
  const child = crossover(a, b, rng);
  for (let i = 0; i < child.length; i++) assert.ok(child[i] === a[i] || child[i] === b[i]);
  const { genome, mutations } = mutate(child, rng, 0.01);
  assert.equal(genome.length, layout.size);
  assert.ok(mutations > 0 && mutations < layout.size * 0.03);
});

test("a thought is deterministic and responds to input", () => {
  const c = syntheticConnectome();
  const roles = detectRoles(c);
  assert.equal(roles.method.motor, "names");
  assert.equal(roles.method.price, "names");
  const layout = layoutFor(c);
  const brain = express(c, layout, randomGenome(layout, new Rng("b")));
  const sc = new Scratch(c.n);
  const s = { r1: 80, r4: 150, dv: 4000 };
  assert.deepEqual(think(c, roles, brain, s, sc), think(c, roles, brain, s, sc));
  const quiet = think(c, roles, brain, { r1: 0, r4: 0, dv: 0 }, sc);
  const loud = think(c, roles, brain, s, sc);
  assert.ok(loud.fired >= quiet.fired);
});

test("a whole run is reproducible from its seed", () => {
  const c = syntheticConnectome();
  const m = syntheticMarket(24 * 6 + 168 + 48);
  const cfg = { ...DEFAULTS, seed: "repro", generations: 5 };
  const a = runExperiment(c, m, cfg);
  const b = runExperiment(c, m, cfg);
  assert.deepEqual(a.generations, b.generations);
  assert.deepEqual(a.holdout, b.holdout);
  assert.equal(a.lineage.length, b.lineage.length);
  // 64 + 16 genesis, then 32 + 8 newborns per generation after the first.
  assert.equal(a.lineage.length, 80 + 4 * 40);
});

test("genome hash is stable", () => {
  assert.equal(genomeHash(new Uint8Array([1, 2, 3])), genomeHash(new Uint8Array([1, 2, 3])));
});

test("exact sign-flip test", () => {
  assert.equal(signFlipTest([1, 1, 1, 1, 1]).p, 1 / 32);
  assert.equal(signFlipTest([0, 0, 0]).p, 1);
  assert.ok(signFlipTest([5, -5, 4, -4]).p > 0.4);
});
