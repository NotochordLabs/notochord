import { existsSync, readFileSync } from "node:fs";
import type { Abi, Address, PublicClient } from "viem";
import generationArtifact from "./artifacts/Generation.json";
import type { Manifest } from "./deploy";
import { HOUR } from "./engine";

const PHASES = ["AwaitingGenesisCommit", "AwaitingGenesis", "Ready", "Open", "Finished"];
/** Candle close, plus time for the runner's one-minute loop and for a confirmation. */
const GRACE_HOURS = 2;

export interface Health {
  checkedAt: string;
  simulated: boolean;
  runner: Address;
  balanceHype: number;
  heartbeat: string | null;
  replicates: { index: number; phase: string; generation: number; hoursRecorded: number; hoursBehind: number }[];
  problems: string[];
}

/** Read only. Says whether the run is keeping up, and from what the chain itself reports. */
export async function health(client: PublicClient, m: Manifest, nowMs: number, heartbeatPath: string, minBalance: number): Promise<Health> {
  const abi = generationArtifact.abi as Abi;
  const problems: string[] = [];
  const replicates = [];
  let runner: Address | null = null;
  for (const rep of m.replicates) {
    const read = <T>(functionName: string) => client.readContract({ address: rep.generation, abi, functionName }) as Promise<T>;
    runner ??= await read<Address>("owner");
    const phase = PHASES[Number(await read<number>("phase"))];
    const generation = Number(await read<number>("generation"));
    const hoursRecorded = Number(await read<number>("hoursRecorded"));
    const done = phase === "Finished" ? m.rules.generations * m.rules.hoursPerGeneration : generation * m.rules.hoursPerGeneration + (phase === "Open" ? hoursRecorded : 0);
    const due = Math.min(Math.floor((nowMs - m.startMs) / HOUR), m.rules.generations * m.rules.hoursPerGeneration);
    const hoursBehind = Math.max(0, due - done);
    if (hoursBehind > GRACE_HOURS) problems.push(`replicate ${rep.index} is ${hoursBehind} hours behind`);
    replicates.push({ index: rep.index, phase, generation, hoursRecorded, hoursBehind });
  }
  const balanceHype = Number(await client.getBalance({ address: runner! })) / 1e18;
  if (balanceHype < minBalance) problems.push(`wallet balance is low: ${balanceHype} HYPE`);
  const heartbeat = existsSync(heartbeatPath) ? readFileSync(heartbeatPath, "utf8") : null;
  if (heartbeat && nowMs - Date.parse(heartbeat) > 10 * 60_000) problems.push(`no heartbeat from the runner since ${heartbeat}`);
  return { checkedAt: new Date(nowMs).toISOString(), simulated: m.simulated, runner: runner!, balanceHype, heartbeat, replicates, problems };
}
