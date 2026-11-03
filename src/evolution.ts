import { express, type Brain } from "./brain";
import type { Connectome } from "./connectome";
import { crossover, mutate, randomGenome, type Layout } from "./genome";
import { Rng } from "./rng";

export interface Specimen {
  id: number;
  population: "selection" | "control";
  born: number; // generation of birth
  parents: [number, number] | null;
  genome: Uint8Array;
  brain: Brain;
}

export type Mode = "selection" | "control";

export class IdCounter {
  private next = 1;
  take(): number {
    return this.next++;
  }
}

/** Genesis: popSize random genomes from one seed. */
export function genesis(
  c: Connectome,
  layout: Layout,
  seed: string,
  size: number,
  population: Mode,
  ids: IdCounter,
): Specimen[] {
  const rng = new Rng(`${seed}/genesis`);
  const out: Specimen[] = [];
  for (let k = 0; k < size; k++) {
    const genome = randomGenome(layout, rng);
    out.push({ id: ids.take(), population, born: 0, parents: null, genome, brain: express(c, layout, genome) });
  }
  return out;
}

/**
 * Survivors: the better half by fitness (selection) or a random half
 * (control). Ties are broken by id so the order is always reproducible.
 */
export function survive(pop: Specimen[], fitness: Map<number, number>, mode: Mode, rng: Rng): Specimen[] {
  const half = Math.floor(pop.length / 2);
  if (mode === "control") return rng.shuffle(pop).slice(0, half).sort((a, b) => a.id - b.id);
  return pop
    .slice()
    .sort((a, b) => fitness.get(b.id)! - fitness.get(a.id)! || a.id - b.id)
    .slice(0, half)
    .sort((a, b) => a.id - b.id);
}

/** Each survivor has one child with a random other survivor, then mutation. */
export function reproduce(
  c: Connectome,
  layout: Layout,
  survivors: Specimen[],
  generation: number,
  rng: Rng,
  mutationRate: number,
  ids: IdCounter,
  targetSize: number,
): Specimen[] {
  const children: Specimen[] = [];
  let k = 0;
  while (survivors.length + children.length < targetSize) {
    const parent = survivors[k % survivors.length];
    let mate = survivors[rng.int(survivors.length)];
    if (survivors.length > 1) while (mate.id === parent.id) mate = survivors[rng.int(survivors.length)];
    const { genome } = mutate(crossover(parent.genome, mate.genome, rng), rng, mutationRate);
    children.push({
      id: ids.take(),
      population: parent.population,
      born: generation,
      parents: [parent.id, mate.id],
      genome,
      brain: express(c, layout, genome),
    });
    k++;
  }
  return survivors.concat(children);
}
