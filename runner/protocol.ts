import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rules } from "./engine";

export interface Protocol {
  version: string;
  status: string;
  seed: string;
  market: { coin: string };
  populations: { selection: number; control: number };
  generations: number;
  hoursPerGeneration: number;
  holdoutHours: number;
  mutationRate: number;
  feeBps: number;
  replicates: { main: number; shuffledWiring: number };
  test: { alpha: number };
  node: string;
}

export const LOCKED = "locked";

export const loadProtocol = (file = "v0.2.json") => JSON.parse(readFileSync(join("protocol", file), "utf8")) as Protocol;

export interface DeploymentPlan {
  name: string;
  rules: Rules;
  main: number;
  shuffled: number;
  coin: string;
  seed?: string;
  nodeVersion: string;
}

/**
 * Names beginning "test-" may use any size, and cannot be mistaken for the
 * experiment. Every other deployment must match the locked protocol exactly.
 */
export function deploymentProblems(plan: DeploymentPlan, p: Protocol): string[] {
  const out: string[] = [];
  if (plan.nodeVersion !== `v${p.node}`) out.push(`Node ${p.node} is required, this machine has ${plan.nodeVersion}.`);
  if (plan.name.startsWith("test-")) return out;
  if (p.status !== LOCKED) out.push(`Protocol is not locked (status: "${p.status}"). For a trial, start the name with "test-".`);
  const same = (label: string, got: unknown, want: unknown) => {
    if (got !== want) out.push(`${label}: ${got}, protocol says ${want}.`);
  };
  same("Selection", plan.rules.selectionSize, p.populations.selection);
  same("Control", plan.rules.controlSize, p.populations.control);
  same("Generations", plan.rules.generations, p.generations);
  same("Hours per generation", plan.rules.hoursPerGeneration, p.hoursPerGeneration);
  same("Unseen period", plan.rules.holdoutHours, p.holdoutHours);
  same("Main replicates", plan.main, p.replicates.main);
  same("Shuffled replicates", plan.shuffled, p.replicates.shuffledWiring);
  same("Market", plan.coin, p.market.coin);
  if (plan.seed !== undefined) same("Seed", plan.seed, p.seed);
  return out;
}
