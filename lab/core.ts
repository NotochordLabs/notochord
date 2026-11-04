// The Lab: breeding from the experiment's fossils and racing the children on the
// next day of the live market. Every step reuses the experiment's own code
// (crossover, mutation, the brain, the score), so a Lab brain behaves exactly like
// an experiment brain would. Nothing here touches the experiment's state.

import { keccak256 } from "viem";
import { express, Scratch } from "../src/brain";
import type { Connectome } from "../src/connectome";
import { crossover, genomeHash, mutate, type Layout } from "../src/genome";
import { score, type Market } from "../src/market";
import type { Roles } from "../src/roles";
import { Rng } from "../src/rng";

/** Same mutation rate as the experiment. */
export const LAB_MUTATION_RATE = 0.01;
/** One race is one UTC day. */
export const LAB_RACE_HOURS = 24;

/**
 * A child's genome. The stream is seeded by the brain's id and the randomness of
 * the drand round committed when it was bred, so it cannot be known in advance.
 * Parent order is the order recorded on chain.
 */
export function labChild(parentA: Uint8Array, parentB: Uint8Array, id: number, randomness: string): Uint8Array {
  if (parentA.length !== parentB.length) throw new Error("Parents have different genome sizes.");
  const rng = new Rng(`notochord-lab/v1/${id}/${randomness.toLowerCase()}`);
  return mutate(crossover(parentA, parentB, rng), rng, LAB_MUTATION_RATE).genome;
}

export const labGenomeHash = (g: Uint8Array) => `0x${genomeHash(g)}` as const;

export interface LabRace {
  pnl: number;
  maxDrawdown: number;
  fitness: number;
  /** One byte per hour: 0 hold, 1 buy, 2 sell, as in the experiment's Thought events. */
  decisions: Uint8Array;
  decisionsHash: `0x${string}`;
}

/** Paper-trade a genome over `hours` starting at market index `start`, with the experiment's score. */
export function labRace(
  connectome: Connectome,
  layout: Layout,
  roles: Roles,
  genome: Uint8Array,
  market: Market,
  start: number,
  hours = LAB_RACE_HOURS,
): LabRace {
  const brain = express(connectome, layout, genome);
  const raw = new Int8Array(hours);
  const s = score(connectome, roles, brain, market, start, hours, new Scratch(connectome.n), raw);
  const decisions = Uint8Array.from(raw, (d) => (d === 1 ? 1 : d === -1 ? 2 : 0));
  const hex = `0x${Buffer.from(decisions).toString("hex")}` as const;
  return {
    pnl: Math.round(s.pnl),
    maxDrawdown: Math.round(s.maxDD),
    fitness: Math.round(s.pnl) - (Math.round(s.maxDD) >> 1),
    decisions,
    decisionsHash: keccak256(hex),
  };
}
