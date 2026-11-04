"use client";

import { useEffect, useState } from "react";
import { useLiveFeed } from "@/lib/live";

/**
 * Says "live" only when a published deployment answers on chain. Until
 * site/public/live/config.json says deployed, or if a read fails, the site stays labelled as a
 * simulation preview. Never shows a value the chain did not return.
 */
interface Config { deployed?: boolean; rpc: string; chainId: number; simulated: boolean; generations: number; replicates: string[] }
const PHASE = "0xb1c9fe6e", GENERATION = "0x17219522", HOURS = "0x3d6ec6bd";

async function call(rpc: string, to: string, data: string): Promise<number> {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
  const j = await res.json();
  if (typeof j.result !== "string" || j.result === "0x") throw new Error("no result");
  return Number(BigInt(j.result));
}

export function useLive() {
  const [deployed, setDeployed] = useState(false);
  const [live, setLive] = useState<{ gen: number; hour: number; total: number; finished: boolean } | null>(null);
  useEffect(() => {
    let stop = false;
    const read = async () => {
      try {
        const cfg = (await (await fetch("/live/config.json")).json()) as Config;
        // A local or test deployment must never be presented as the experiment.
        if (!cfg.deployed || cfg.simulated || cfg.chainId !== 99901) return;
        if (!stop) setDeployed(true);
        const to = cfg.replicates[0];
        const [phase, gen, hour] = await Promise.all([call(cfg.rpc, to, PHASE), call(cfg.rpc, to, GENERATION), call(cfg.rpc, to, HOURS)]);
        if (!stop) setLive({ gen, hour, total: cfg.generations, finished: phase === 4 });
      } catch {
        if (!stop) setLive(null);
      }
    };
    read();
    const t = setInterval(read, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return { live, deployed };
}

/** The rail note is hidden on phones, so the same fact sits beside the menu there. */
export function SimChip() {
  // The charts on this site remain an archived simulation even while the chain runs.
  return <span className="simChip">Archive charts</span>;
}

export default function LiveStatus() {
  const { live, deployed } = useLive();
  if (!deployed) return <p className="railNote">Simulation preview on historical data. No funds are managed and no returns are promised.</p>;
  return (
    <p className="railNote">
      <b>On chain, Elysium.</b> {!live ? "Status could not be read." : live.finished ? `All ${live.total} generations closed.` : `Generation ${live.gen + 1} of ${live.total}, hour ${live.hour}.`} Charts show the archived simulation. No funds managed, no returns promised.
    </p>
  );
}

/** The headline state of the experiment. Same rule: on-chain wording only from a chain answer. */
export function HeadStatus() {
  const { live, deployed } = useLive();
  const { latest } = useLiveFeed();
  const phase = !deployed ? "Not started on chain" : !live ? "On chain since 4 Nov 2026" : live.finished ? `All ${live.total} generations closed` : `Generation ${live.gen + 1} of ${live.total}, on chain`;
  return (
    <dl className="headStatus">
      <div><dt>Experiment</dt><dd>{phase}</dd></div>
      {latest && <div><dt>This hour, {latest.replicates} replicates</dt><dd>{latest.buy} buy, {latest.sell} sell, {latest.hold} hold</dd></div>}
      <div><dt>Earlier test</dt><dd>Market learning not shown</dd></div>
      <div className="headLink"><a className="headPrimary" href="/how/">How it works</a><a href="/report/">Read the report</a></div>
    </dl>
  );
}
