/** Wiring and test thoughts for ThoughtVerifier.t.sol, computed by the TypeScript brain. */
import { readFileSync, writeFileSync } from "node:fs";
import { express, Scratch, think } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { genomeHash, layoutFor } from "../src/genome";
import { detectRoles } from "../src/roles";
import { Rng } from "../src/rng";
import { wiringBytes } from "../runner/thought-verifier";
const c = loadConnectome("data/connectome"), roles = detectRoles(c), layout = layoutFor(c), sc = new Scratch(c.n);
const fossil = JSON.parse(readFileSync("out/experiment-177-001/r1/fossils/gen-099.json", "utf8"));
const rng = new Rng("verifier-fixture");
const cases = [];
const senses = [[0, 0, 0], [120, 300, 4000], [-120, -300, 4000], [40, -20, -3000], [5, 8, 100], [-900, -2000, 90000], [70, 70, 0], [-30, 10, 16000]];
for (let k = 0; k < senses.length; k++) {
  const row = k % 2 ? fossil.selection[rng.int(64)] : fossil.control[rng.int(16)];
  const g = Uint8Array.from(Buffer.from(row.genome, "hex"));
  const [r1, r4, dv] = senses[k];
  const t = think(c, roles, express(c, layout, g), { r1, r4, dv }, sc);
  cases.push({ genome: "0x" + row.genome, r1, r4, dv, decision: t.decision, fired: t.fired, motorL: t.motorL, motorR: t.motorR, hash: "0x" + genomeHash(g) });
}
// Random brains too, so buy decisions are covered as well as sell and hold.
const need: Record<number, number> = { 1: 4, [-1]: 2 };
for (let tries = 0; tries < 4000 && (need[1] > 0 || need[-1] > 0); tries++) {
  const row = fossil.control[rng.int(16)];
  const g = Uint8Array.from(Buffer.from(row.genome, "hex"));
  for (let i = 0; i < g.length; i++) if (rng.int(8) === 0) g[i] = rng.int(256);
  const [r1, r4, dv] = [rng.int(400) - 200, rng.int(800) - 400, rng.int(30000)];
  const t = think(c, roles, express(c, layout, g), { r1, r4, dv }, sc);
  if (t.decision === 0 || need[t.decision] <= 0) continue;
  need[t.decision]--;
  cases.push({ genome: "0x" + Buffer.from(g).toString("hex"), r1, r4, dv, decision: t.decision, fired: t.fired, motorL: t.motorL, motorR: t.motorR, hash: "0x" + genomeHash(g) });
}
writeFileSync("contracts/test/fixtures/thoughts.json", JSON.stringify({ cells: c.n, edges: c.edgeSrc.length, wiring: wiringBytes({ connectome: c, roles, layout, scratch: sc }), count: cases.length, cases }));
console.log(cases.map((x) => `${x.decision}/${x.fired}/${x.motorL}/${x.motorR}`).join(" "));
