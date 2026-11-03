import { keccak256, encodePacked } from "viem";
import { express, Scratch, think } from "../src/brain";
import type { Connectome } from "../src/connectome";
import { genesis, IdCounter, reproduce, survive, type Mode, type Specimen } from "../src/evolution";
import { genomeHash, layoutFor, type Layout } from "../src/genome";
import { score, type Market } from "../src/market";
import { detectRoles, type Roles } from "../src/roles";
import { Rng } from "../src/rng";
import { shuffleConnectome } from "../src/shuffle";

export const HOUR = 3600_000;
const MUTATION_RATE = 0.01;

export interface Rules {
  selectionSize: number;
  controlSize: number;
  generations: number;
  hoursPerGeneration: number;
  holdoutHours: number;
}

export const PROTOCOL_RULES: Rules = {
  selectionSize: 64,
  controlSize: 16,
  generations: 100,
  hoursPerGeneration: 24,
  holdoutHours: 672,
};

/** Everything one replicate needs in memory. Regenerated from JSON on restart. */
export interface Population {
  generation: number;
  nextId: number;
  selection: Specimen[];
  control: Specimen[];
}

export interface Lab {
  connectome: Connectome;
  layout: Layout;
  roles: Roles;
  scratch: Scratch;
}

export function makeLab(connectome: Connectome): Lab {
  return { connectome, layout: layoutFor(connectome), roles: detectRoles(connectome), scratch: new Scratch(connectome.n) };
}

/**
 * Comparison replicates run on randomised wiring, one shuffle per replicate. The
 * shuffle is fixed by the public seed and index, so the verifier rebuilds it exactly.
 */
export function labFor(real: Lab, seed: string, rep: { index: number; wiring?: "shuffled" }): Lab {
  return rep.wiring === "shuffled" ? makeLab(shuffleConnectome(real.connectome, `${seed}/r${rep.index}`)) : real;
}

/**
 * The drand value is mixed into every random stream, so nobody can choose
 * genomes before the committed round is published. `null` reproduces the
 * offline simulator's streams; it exists to compare the two.
 */
const streamSeed = (seed: string, randomness: string | null) => (randomness ? `${seed}/${randomness}` : seed);

export function createPopulation(lab: Lab, seed: string, randomness: string | null, rules: Rules): Population {
  const ids = new IdCounter();
  const s = streamSeed(seed, randomness);
  const selection = genesis(lab.connectome, lab.layout, s, rules.selectionSize, "selection", ids);
  const control = selection
    .slice(0, rules.controlSize)
    .map((x) => ({ ...x, id: ids.take(), population: "control" as const }));
  return { generation: 0, nextId: ids.take(), selection, control };
}

export const everyone = (p: Population) => [...p.selection, ...p.control];
export const chainHash = (s: Specimen) => `0x${genomeHash(s.genome)}` as const;

/** Commitment to what the brains sensed at one hour. Senses are integers. */
export function inputHash(m: Market, index: number) {
  const s = m.senses[index];
  return keccak256(
    encodePacked(["uint64", "int32", "int32", "int32"], [BigInt(m.candles[index].t), s.r1, s.r4, s.dv]),
  );
}

/** One thought for the whole population, in the byte format Generation expects. */
export function thoughtBytes(lab: Lab, p: Population, m: Market, index: number) {
  const all = everyone(p);
  const decisions = new Uint8Array(all.length);
  const fired = new Uint8Array(all.length);
  all.forEach((s, i) => {
    const t = think(lab.connectome, lab.roles, s.brain, m.senses[index], lab.scratch);
    decisions[i] = t.decision === 1 ? 1 : t.decision === -1 ? 2 : 0;
    fired[i] = t.fired;
  });
  return { decisions, fired };
}

export function fitnessOf(lab: Lab, pop: Specimen[], m: Market, start: number, hours: number): number[] {
  return pop.map((s) => score(lab.connectome, lab.roles, s.brain, m, start, hours, lab.scratch).fitness);
}

export interface Closing {
  selectionFitness: number[];
  controlFitness: number[];
  controlEliminated: number[];
  selectionChildren: { mate: number; genomeHash: `0x${string}` }[];
  controlChildren: { mate: number; genomeHash: `0x${string}` }[];
  next: Population | null;
}

/** Scores a finished generation and, unless it is the last, breeds the next one. */
export function closeGeneration(
  lab: Lab,
  p: Population,
  m: Market,
  startIndex: number,
  seed: string,
  randomness: string | null,
  rules: Rules,
): Closing {
  const hours = rules.hoursPerGeneration;
  const selectionFitness = fitnessOf(lab, p.selection, m, startIndex, hours);
  const controlFitness = fitnessOf(lab, p.control, m, startIndex, hours);
  if (p.generation + 1 === rules.generations) {
    return { selectionFitness, controlFitness, controlEliminated: [], selectionChildren: [], controlChildren: [], next: null };
  }

  const ids = new IdCounter();
  for (let i = 1; i < p.nextId; i++) ids.take();
  const fit = new Map<number, number>();
  p.selection.forEach((s, i) => fit.set(s.id, selectionFitness[i]));
  p.control.forEach((s, i) => fit.set(s.id, controlFitness[i]));

  const breed = (pop: Specimen[], mode: Mode, size: number) => {
    const rng = new Rng(`${streamSeed(seed, randomness)}/gen/${p.generation}/${mode}`);
    const survivors = survive(pop, fit, mode, rng);
    const keep = new Set(survivors.map((s) => s.id));
    const next = reproduce(lab.connectome, lab.layout, survivors, p.generation + 1, rng, MUTATION_RATE, ids, size);
    const children = next.slice(survivors.length).map((s) => ({ mate: s.parents![1], genomeHash: chainHash(s) }));
    return { next, children, eliminated: pop.filter((s) => !keep.has(s.id)).map((s) => s.id) };
  };
  const a = breed(p.selection, "selection", rules.selectionSize);
  const b = breed(p.control, "control", rules.controlSize);
  return {
    selectionFitness,
    controlFitness,
    controlEliminated: b.eliminated,
    selectionChildren: a.children,
    controlChildren: b.children,
    next: { generation: p.generation + 1, nextId: ids.take(), selection: a.next, control: b.next },
  };
}

/* ---- persistence ---- */

const toRow = (s: Specimen) => ({ id: s.id, born: s.born, parents: s.parents, genome: Buffer.from(s.genome).toString("hex") });

export const serialize = (p: Population) => ({
  generation: p.generation,
  nextId: p.nextId,
  selection: p.selection.map(toRow),
  control: p.control.map(toRow),
});
export type SavedPopulation = ReturnType<typeof serialize>;

export function deserialize(lab: Lab, saved: SavedPopulation): Population {
  const load = (rows: SavedPopulation["selection"], population: Mode): Specimen[] =>
    rows.map((r) => {
      const genome = Uint8Array.from(Buffer.from(r.genome, "hex"));
      return { id: r.id, population, born: r.born, parents: r.parents, genome, brain: express(lab.connectome, lab.layout, genome) };
    });
  return {
    generation: saved.generation,
    nextId: saved.nextId,
    selection: load(saved.selection, "selection"),
    control: load(saved.control, "control"),
  };
}
