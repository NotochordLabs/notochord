"use client";

import { useEffect, useState } from "react";

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
  const [live, setLive] = useState<{ gen: number; hour: number; total: number; finished: boolean } | null>(null);
  useEffect(() => {
    let stop = false;
    const read = async () => {
      try {
        const cfg = (await (await fetch("/live/config.json")).json()) as Config;
        // A local or test deployment must never be presented as the experiment.
        if (!cfg.deployed || cfg.simulated || cfg.chainId !== 99901) return;
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
  return live;
}

/** The rail note is hidden on phones, so the same fact sits beside the menu there. */
export function SimChip() {
  const live = useLive();
  return live ? null : <span className="simChip">Simulation</span>;
}

export default function LiveStatus() {
  const live = useLive();
  if (!live) return <p className="railNote">Simulation preview on historical data. The experiment has not started on chain. No funds are managed and no returns are promised.</p>;
  return (
    <p className="railNote">
      <b>On chain, Elysium.</b> {live.finished ? `All ${live.total} generations closed.` : `Generation ${live.gen} of ${live.total}, hour ${live.hour}.`} The charts here still show the archived simulation. No funds are managed and no returns are promised.
    </p>
  );
}

/** The headline state of the experiment. Same rule: on-chain wording only from a chain answer. */
export function HeadStatus() {
  const live = useLive();
  const phase = !live ? "Not started on chain" : live.finished ? `All ${live.total} generations closed` : `Generation ${live.gen} of ${live.total}, on chain`;
  return (
    <dl className="headStatus">
      <div><dt>Experiment</dt><dd>{phase}</dd></div>
      <div><dt>First measurement</dt><dd>Market learning not shown</dd></div>
      <div className="headLink"><a href="/report/">Read the report</a></div>
    </dl>
  );
}
