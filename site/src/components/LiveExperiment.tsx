"use client";

import { useLiveFeed, type LiveThought, type RepState } from "@/lib/live";

const PHASES = ["Waiting to commit", "Waiting for the first brains", "Between generations", "Running", "Finished"];
const short = (x: string) => `${x.slice(0, 8)}…${x.slice(-6)}`;

/** The whole run at a glance: one tile per generation, then the unseen days. */
function Timeline({ done, generations, hoursPerGeneration, holdoutDays }: { done: number; generations: number; hoursPerGeneration: number; holdoutDays: number }) {
  return (
    <div className="runLine" role="progressbar" aria-valuemin={0} aria-valuemax={generations * hoursPerGeneration} aria-valuenow={done} aria-label="Hours recorded on chain">
      <div className="runGens" style={{ flexGrow: generations }}>
        {Array.from({ length: generations }, (_, g) => {
          const part = Math.max(0, Math.min(1, done / hoursPerGeneration - g));
          return <i key={g}><u style={{ width: `${part * 100}%` }} /></i>;
        })}
      </div>
      <div className="runHoldout" style={{ flexGrow: holdoutDays }}>{holdoutDays} unseen days</div>
    </div>
  );
}

/** Each column an hour, each row a replicate. A hole in a past hour means nothing reached the chain for it. */
function HourGrid({ thoughts, reps, hoursPerGeneration }: { thoughts: LiveThought[]; reps: RepState[]; hoursPerGeneration: number }) {
  const key = (t: LiveThought) => t.generation * hoursPerGeneration + t.hour;
  const newest = Math.max(...thoughts.map(key));
  const first = Math.max(0, newest - 47);
  const at = new Map(thoughts.map((t) => [`${t.replicate}:${key(t)}`, t]));
  const hours = Array.from({ length: 48 }, (_, i) => first + i);
  const net = (t: LiveThought) => (t.buy + t.sell + t.hold ? (t.buy - t.sell) / (t.buy + t.sell + t.hold) : 0);
  const strongest = Math.max(...thoughts.map((t) => Math.abs(net(t))), 0.01);
  return (
    <figure className="hourGrid">
      <div role="img" aria-label="Hourly decisions on chain, by replicate. The same counts are in the transactions table.">
        {reps.map((r) => (
          <div className="hourRow" key={r.index}>
            <span>{r.index}</span>
            {hours.map((h) => {
              const t = at.get(`${r.index}:${h}`);
              if (!t) return <i key={h} className={h > newest ? "later" : "gap"} title={h > newest ? undefined : `Replicate ${r.index}, hour ${h + 1}: nothing recorded`} />;
              const n = net(t);
              const color = n >= 0 ? "70, 224, 140" : "255, 92, 154";
              return <i key={h} style={{ background: `rgba(${color}, ${(0.2 + (Math.abs(n) / strongest) * 0.8).toFixed(2)})` }} title={`Replicate ${r.index}, hour ${h + 1}: ${t.buy} buy, ${t.sell} sell, ${t.hold} hold`} />;
            })}
          </div>
        ))}
      </div>
      <figcaption>
        <span className="hourKey"><i style={{ background: "rgb(70, 224, 140)" }} />more buy</span>
        <span className="hourKey"><i style={{ background: "rgb(255, 92, 154)" }} />more sell</span>
        <span className="hourKey"><i className="gap" />nothing recorded</span>
        <span>Hours {first + 1} to {first + 48} of the run, real wiring. A count of decisions, not a signal.</span>
      </figcaption>
    </figure>
  );
}

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
      <Timeline done={done} generations={generations} hoursPerGeneration={hoursPerGeneration} holdoutDays={holdoutHours / 24} />
      {f.failed && <p className="testNote">The last read failed. These numbers may be a few minutes old.</p>}

      {f.latest && (
        <>
          <h2>This hour</h2>
          <div className="voteBar" aria-hidden="true">
            <i style={{ flexGrow: f.latest.buy, background: "var(--gfp)" }} />
            <i style={{ flexGrow: f.latest.sell, background: "var(--cherry)" }} />
            <i style={{ flexGrow: f.latest.hold, background: "var(--line)" }} />
          </div>
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

      {f.thoughts.length > 0 && (
        <>
          <h2>The last 48 hours</h2>
          <HourGrid thoughts={f.thoughts} reps={f.reps.filter((r) => !r.shuffled)} hoursPerGeneration={hoursPerGeneration} />
        </>
      )}

      <details className="more">
        <summary>All replicates</summary>
      <div className="tableWrap">
        <table>
          <thead><tr><th>Replicate</th><th>Wiring</th><th>State</th><th className="num">Generation</th><th className="num">Hour</th><th>Contract</th></tr></thead>
          <tbody>
            {f.reps.map((r) => <tr key={r.index}><td>{r.index}</td><td>{r.shuffled ? "Shuffled" : "Real"}</td><td>{PHASES[r.phase] ?? "Unknown"}</td><td className="num">{Math.min(r.generation + 1, generations)}</td><td className="num">{r.hours}</td><td><code>{short(r.address)}</code></td></tr>)}
          </tbody>
        </table>
      </div>
      </details>

      <details className="more">
        <summary>Latest transactions</summary>
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
      </details>
      <p className="testNote">Chain ID {f.manifest.chainId}{f.block ? `, block ${f.block.toLocaleString("en-US")}` : ""}.</p>
    </>
  );
}
