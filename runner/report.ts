import { parseAbiItem, type Address, type PublicClient } from "viem";
import { ALPHA, mean, signFlipTest } from "../src/stats";

const CLOSED = parseAbiItem("event GenerationClosed(uint32 indexed generation, bytes32 drandRandomness, int32[] selectionFitness, int32[] controlFitness)");
const HOLDOUT = parseAbiItem("event HoldoutRecorded(bytes32 inputHash, int32[] selectionFitness, int32[] controlFitness)");

export interface ChainResult {
  generations: number;
  trainingDiffs: number[];
  holdoutVsControl: number[];
  holdoutVsFlat: number[];
}

/** Everything here is read back from chain events, not from the runner's memory. */
export async function readResults(client: PublicClient, generations: Address[]): Promise<ChainResult> {
  const result: ChainResult = { generations: 0, trainingDiffs: [], holdoutVsControl: [], holdoutVsFlat: [] };
  for (const address of generations) {
    const closed = await client.getLogs({ address, event: CLOSED, fromBlock: 0n, toBlock: "latest" });
    result.generations = closed.length;
    const diffs = closed.map((l) =>
      Math.round(mean([...l.args.selectionFitness!])) - Math.round(mean([...l.args.controlFitness!])),
    );
    result.trainingDiffs.push(Math.round(mean(diffs)));
    const [holdout] = await client.getLogs({ address, event: HOLDOUT, fromBlock: 0n, toBlock: "latest" });
    if (holdout) {
      const s = Math.round(mean([...holdout.args.selectionFitness!]));
      const c = Math.round(mean([...holdout.args.controlFitness!]));
      result.holdoutVsControl.push(s - c);
      result.holdoutVsFlat.push(s);
    }
  }
  return result;
}

export function formatResults(r: ChainResult, simulated: boolean): string {
  const row = (label: string, xs: number[]) => {
    if (!xs.length) return `${label}: none yet`;
    const t = signFlipTest(xs);
    return `${label}: mean ${Math.round(t.observed)} bps, ${xs.filter((x) => x > 0).length}/${xs.length} positive, p = ${t.p.toFixed(4)}`;
  };
  const passes = (xs: number[]) => xs.length > 0 && signFlipTest(xs).p <= ALPHA;
  const lines = [
    simulated ? "!! SIMULATION: historical data and a fake drand. These numbers are not experiment results. !!" : "Results read from the chain",
    `Closed generations (per replicate): ${r.generations}`,
    row("Training: selection − control", r.trainingDiffs),
    row("Unseen period: selection − control", r.holdoutVsControl),
    row("Unseen period: selection − not trading", r.holdoutVsFlat),
    passes(r.holdoutVsControl) && passes(r.holdoutVsFlat)
      ? `Result: H0 rejected (p ≤ ${ALPHA}).`
      : `Result: H0 not rejected (threshold p ≤ ${ALPHA}).`,
  ];
  return lines.join("\n");
}
