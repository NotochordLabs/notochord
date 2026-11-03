import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { loadConnectome } from "../src/connectome";
import { detectRoles } from "../src/roles";
import { shuffleConnectome } from "../src/shuffle";

const hasData = existsSync("data/connectome/nodes.csv");

// Counts from Ryan, Lu & Meinertzhagen 2016 (eLife 5:e16962), article text and Table 3.
// This checks classes only. Cell-by-cell identity needs Figure 3, source data 1.
test("sensory and motor classes match the counts in the paper", { skip: !hasData }, () => {
  const c = loadConnectome("data/connectome");
  const r = detectRoles(c);
  assert.deepEqual([...r.priceUp, ...r.priceDown].map((i) => c.names[i]).sort(), ["Ant1", "Ant2"]);
  assert.equal(r.volume.length, 23, "type I photoreceptors");
  assert.equal(c.names.filter((n) => /^pr[a-g]$/.test(n)).length, 7, "type II photoreceptors");
  assert.equal(r.motorL.length, 5, "motor neuron pairs");
  assert.equal(r.motorR.length, 5, "motor neuron pairs");
  assert.equal(r.method.price, "names");
  assert.equal(r.method.motor, "names");
});

test("shuffled wiring keeps every cell's degree, the weights and the genome size", { skip: !hasData }, () => {
  const c = loadConnectome("data/connectome");
  const s = shuffleConnectome(c, "t");
  const degrees = (x: typeof c) => {
    const d = new Int32Array(x.n * 2);
    x.edgeSrc.forEach((v, e) => { d[v]++; d[x.n + x.edgeDst[e]]++; });
    return [...d];
  };
  assert.deepEqual(degrees(s), degrees(c));
  assert.deepEqual([...s.edgeBase].sort(), [...c.edgeBase].sort());
  assert.equal(s.edgeSrc.length, c.edgeSrc.length);
  assert.deepEqual(detectRoles(s).volume, detectRoles(c).volume);
  assert.notDeepEqual([...s.edgeDst], [...c.edgeDst]);
  assert.deepEqual([...shuffleConnectome(c, "t").edgeDst], [...s.edgeDst]);
  const pairs = new Set(s.edgeSrc.map((v, e) => v * s.n + s.edgeDst[e]));
  assert.equal(pairs.size, s.edgeSrc.length, "no duplicate connections");
  for (let e = 0; e < s.edgeSrc.length; e++) assert.notEqual(s.edgeSrc[e], s.edgeDst[e], "no self connections");
});
