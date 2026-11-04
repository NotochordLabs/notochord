"use client";

import { useLiveFeed } from "@/lib/live";

const PHASES = ["Waiting to commit", "Waiting for the first brains", "Between generations", "Running", "Finished"];
const short = (x: string) => `${x.slice(0, 8)}…${x.slice(-6)}`;

export default function LiveExperiment() {
  const f = useLiveFeed();
  if (!f.manifest) {
    return f.failed
      ? <div className="testState"><strong>Elysium did not answer</strong><p>This browser could not read the chain, so nothing is shown. Nothing here is ever filled in from a simulation. It tries again every two minutes.</p></div>
      : <div className="testState"><strong>Reading the chain…</strong></div>;
  }
  const { generations, hoursPerGeneration, holdoutHours } = f.manifest.rules;
  const first = f.reps[0];
  const total = generations * hoursPerGeneration;
  const done = first ? Math.min(total, first.generation * hoursPerGeneration + (first.phase === 3 ? first.hours : 0)) : 0;
  const start = new Date(f.manifest.startMs).toISOString().slice(0, 16).replace("T", " ");
  return (
    <>
      <div className="testNumbers">
        <div><span>Generation</span><b>{first ? Math.min(first.generation + 1, generations) : "…"} of {generations}</b></div>
        <div><span>Hours recorded</span><b>{done} of {total}</b></div>
        <div><span>Then unseen data</span><b>{holdoutHours / 24} days</b></div>
        <div><span>Start</span><b>{start} UTC</b></div>
      </div>
      <div className="testBar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Hours recorded on chain"><i style={{ width: `${(done / total) * 100}%` }} /></div>
      {f.failed && <p className="testNote">The last read failed. These numbers may be a few minutes old.</p>}

      {f.latest && (
        <>
          <h2>This hour</h2>
          <p className="liveCount"><b>{f.latest.buy}</b> buy <b>{f.latest.sell}</b> sell <b>{f.latest.hold}</b> hold</p>
          <p className="testNote">Generation {f.latest.generation + 1}, hour {f.latest.hour + 1}, across {f.latest.replicates} real-wiring replicates. A count of decisions, not a signal: market learning has not been shown.</p>
        </>
      )}

      {f.brain && (
        <>
          <h2>One brain, recomputed here</h2>
          <p>Specimen {f.brain.specimen}: its genome from the generation {f.brain.fossilGeneration + 1} fossil on chain, the public HYPE candle, and the same engine, run in this browser. {f.brain.agrees ? "Its decision matches the one on chain." : "Its decision does not match the one on chain; please report this."}</p>
        </>
      )}

      <h2>Replicates</h2>
      <div className="tableWrap">
        <table>
          <thead><tr><th>Replicate</th><th>Wiring</th><th>State</th><th className="num">Generation</th><th className="num">Hour</th><th>Contract</th></tr></thead>
          <tbody>
            {f.reps.map((r) => <tr key={r.index}><td>{r.index}</td><td>{r.shuffled ? "Shuffled" : "Real"}</td><td>{PHASES[r.phase] ?? "Unknown"}</td><td className="num">{Math.min(r.generation + 1, generations)}</td><td className="num">{r.hours}</td><td><code>{short(r.address)}</code></td></tr>)}
          </tbody>
        </table>
      </div>

      <h2>Latest transactions</h2>
      {f.thoughts.length === 0 ? <p className="testNote">No hourly decisions yet. The first arrives about an hour after the generation opens.</p> : (
        <div className="tableWrap">
          <table>
            <thead><tr><th>Replicate</th><th className="num">Generation</th><th className="num">Hour</th><th className="num">Buy</th><th className="num">Sell</th><th className="num">Hold</th><th>Transaction</th></tr></thead>
            <tbody>
              {f.thoughts.slice(0, 12).map((t) => <tr key={t.tx}><td>{t.replicate}</td><td className="num">{t.generation + 1}</td><td className="num">{t.hour + 1}</td><td className="num">{t.buy}</td><td className="num">{t.sell}</td><td className="num">{t.hold}</td><td><code>{short(t.tx)}</code></td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      <p className="testNote">Chain ID {f.manifest.chainId}{f.block ? `, block ${f.block.toLocaleString("en-US")}` : ""}.</p>
    </>
  );
}
