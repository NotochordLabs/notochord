/**
 * Exports the first generations of a real simulator run as a Foundry test
 * fixture, using the same functions and seeds as runExperiment. Before writing
 * it checks the result against the fossil that run saved, so the contract tests
 * replay what the simulator really did.
 *
 *   npx tsx scripts/export-chain-fixture.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Scratch } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { genesis, IdCounter, reproduce, survive, type Specimen } from "../src/evolution";
import { DEFAULTS } from "../src/experiment";
import { genomeHash, layoutFor } from "../src/genome";
import { loadMarket, score } from "../src/market";
import { detectRoles } from "../src/roles";
import { Rng } from "../src/rng";

const SEED = "experiment-177-001/r1";
const FOSSIL = "out/experiment-177-001/r1/fossils/gen-010.json";
const LAST = 10;

const c = loadConnectome("data/connectome");
const m = loadMarket("data/prices-HYPE-1h.json");
const roles = detectRoles(c);
const layout = layoutFor(c);
const holdoutStart = m.candles.length - 1 - DEFAULTS.holdoutHours;
const trainStart = holdoutStart - DEFAULTS.generations * DEFAULTS.hoursPerGeneration;
const hash = (s: Specimen) => "0x" + genomeHash(s.genome);

const ids = new IdCounter();
let sel = genesis(c, layout, SEED, DEFAULTS.popSize, "selection", ids);
let ctl: Specimen[] = sel.slice(0, DEFAULTS.controlSize).map((s) => ({ ...s, id: ids.take(), population: "control" as const }));
const genesisHashes = { selection: sel.map(hash), control: ctl.map(hash) };

const sc = new Scratch(c.n);
const generations: unknown[] = [];
for (let g = 0; g < LAST; g++) {
  const start = trainStart + g * DEFAULTS.hoursPerGeneration;
  const fit = new Map<number, number>();
  for (const s of [...sel, ...ctl]) fit.set(s.id, score(c, roles, s.brain, m, start, DEFAULTS.hoursPerGeneration, sc).fitness);

  const step = (pop: Specimen[], mode: "selection" | "control", size: number) => {
    const rng = new Rng(`${SEED}/gen/${g}/${mode}`);
    const survivors = survive(pop, fit, mode, rng);
    const keep = new Set(survivors.map((s) => s.id));
    const next = reproduce(c, layout, survivors, g + 1, rng, DEFAULTS.mutationRate, ids, size);
    return {
      fitness: pop.map((s) => fit.get(s.id)!),
      eliminated: pop.filter((s) => !keep.has(s.id)).map((s) => s.id),
      children: next.slice(survivors.length),
      next,
    };
  };
  const a = step(sel, "selection", DEFAULTS.popSize);
  const b = step(ctl, "control", DEFAULTS.controlSize);
  generations.push({
    selectionIds: sel.map((s) => s.id),
    controlIds: ctl.map((s) => s.id),
    selectionFitness: a.fitness,
    controlFitness: b.fitness,
    selectionEliminated: a.eliminated,
    controlEliminated: b.eliminated,
    selectionChildIds: a.children.map((s) => s.id),
    selectionChildMates: a.children.map((s) => s.parents![1]),
    selectionChildHashes: a.children.map(hash),
    controlChildIds: b.children.map((s) => s.id),
    controlChildMates: b.children.map((s) => s.parents![1]),
    controlChildHashes: b.children.map(hash),
  });
  sel = a.next;
  ctl = b.next;
}

const fossil = JSON.parse(readFileSync(FOSSIL, "utf8"));
const same = (pop: Specimen[], saved: { id: number; hash: string }[]) =>
  pop.length === saved.length && pop.every((s, i) => s.id === saved[i].id && genomeHash(s.genome) === saved[i].hash);
if (!same(sel, fossil.selection) || !same(ctl, fossil.control)) throw new Error(`Fixture does not match ${FOSSIL}`);

mkdirSync("contracts/test/fixtures", { recursive: true });
writeFileSync(
  "contracts/test/fixtures/r1-gen0-10.json",
  JSON.stringify({
    source: SEED,
    genomeSize: layout.size,
    genesis: genesisHashes,
    generations,
    final: {
      selectionIds: sel.map((s) => s.id),
      controlIds: ctl.map((s) => s.id),
      sampleId: sel[0].id,
      sampleGenome: "0x" + fossil.selection[0].genome,
      sampleHash: "0x" + fossil.selection[0].hash,
    },
  }),
);
console.log(`OK: ${LAST} generations match ${FOSSIL}`);
