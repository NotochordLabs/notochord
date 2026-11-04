// Rebuilds every Lab brain from public inputs only: the Lab's events, the
// experiment's fossils, drand and Hyperliquid candles. Needs no wallet and no
// state from the operator.

import { rmSync } from "node:fs";
import { layoutFor } from "../src/genome";
import { detectRoles } from "../src/roles";
import { labChild, labGenomeHash, labRace } from "./core";
import { LabRunner, raceMarket, Status, type LabCtx } from "./runner";

export async function verifyLab(ctx: Omit<LabCtx, "wallet">): Promise<{ ok: boolean; checked: number; problems: string[] }> {
  rmSync(ctx.dir, { recursive: true, force: true }); // start from nothing
  const reader = new LabRunner({ ...ctx, wallet: undefined });
  await reader.sync();
  const layout = layoutFor(ctx.connectome);
  const roles = detectRoles(ctx.connectome);
  const problems: string[] = [];
  const markets = new Map<number, Awaited<ReturnType<typeof raceMarket>>>();
  let checked = 0;
  for (const b of reader.all) {
    if (b.status === Status.Bred) {
      ctx.log(`brain ${b.id}: still waiting for birth on chain, not checked`);
      continue;
    }
    const tag = `brain ${b.id}`;
    const real = await ctx.drand.get(BigInt(b.drandRound), ctx.now());
    if (!real) {
      problems.push(`${tag}: drand round ${b.drandRound} is not available`);
      continue;
    }
    if (real.toLowerCase() !== b.randomness!.toLowerCase()) {
      problems.push(`${tag}: recorded randomness differs from drand round ${b.drandRound}`);
      continue;
    }
    const a = await reader.parentGenome(b.parents[0], b.parentHashes[0]);
    const c = await reader.parentGenome(b.parents[1], b.parentHashes[1]);
    const genome = labChild(a, c, b.id, real);
    if (labGenomeHash(genome) !== b.genomeHash!.toLowerCase()) {
      problems.push(`${tag}: genome hash does not match`);
      continue;
    }
    if (b.status === Status.Raced) {
      let m = markets.get(b.day);
      if (!m) {
        m = await raceMarket(ctx.candles, ctx.manifest.coin, reader.dayStartMs(b.day));
        markets.set(b.day, m);
      }
      const r = labRace(ctx.connectome, layout, roles, genome, m.market, m.start);
      const got = b.result!;
      if (r.pnl !== got.pnl || r.maxDrawdown !== got.maxDrawdown || r.fitness !== got.fitness || r.decisionsHash !== got.decisionsHash) {
        problems.push(`${tag}: race result does not match (chain ${got.pnl}/${got.maxDrawdown}, recomputed ${r.pnl}/${r.maxDrawdown})`);
        continue;
      }
    }
    checked++;
  }
  return { ok: problems.length === 0, checked, problems };
}
