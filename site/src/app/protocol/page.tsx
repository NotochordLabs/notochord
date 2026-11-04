import { ConnectionMatrix, HoldoutPlot } from "@/components/Screens";
import data from "@/data/experiment.json";

const pos = (xs: number[]) => xs.filter((x) => x > 0).length;
const n = (x: number) => Math.round(x).toLocaleString("en-US");

export default function Page() {
  const t = data.tests;
  const rows = [
    { q: "Did selection beat control in training?", mean: `${n(t.training.meanBps)} bps/day`, xs: t.training.diffsBps, p: t.training.p },
    { q: "Did selection beat control on the unseen week?", mean: `${n(t.vsControl.meanBps)} bps`, xs: t.vsControl.diffsBps, p: t.vsControl.p },
    { q: "Did selection beat not trading on the unseen week?", mean: `${n(t.vsFlat.meanBps)} bps`, xs: t.vsFlat.selectionBps, p: t.vsFlat.p },
  ];
  const w = data.weekDecisions;
  return (
    <article className="screen paper">
      <header>
        <h1>Protocol and earlier test</h1>
        <p>The method, what was measured, and what the result does not show.</p>
      </header>

      <div className="protoTop">
        <dl className="protoFacts">
          <div><dt>Cells</dt><dd>{data.brain.cells.length}</dd></div>
          <div><dt>Connections</dt><dd>3,010</dd></div>
          <div><dt>Brains per population</dt><dd>{data.config.popSize} + {data.config.controlSize}</dd></div>
          <div><dt>Generations, one a day</dt><dd>{data.config.generations}</dd></div>
          <div><dt>Unseen days, on chain</dt><dd>28</dd></div>
          <div><dt>Replicates, real + shuffled</dt><dd>6 + 6</dd></div>
        </dl>
        <figure>
          <ConnectionMatrix />
          <figcaption><b>Figure 1.</b> Connection matrix. Each point is one connection: row sends, column receives. Cells are ordered by role.</figcaption>
        </figure>
      </div>

      <details className="more">
        <summary>Method</summary>
            <p>The nervous system of the <i>Ciona intestinalis</i> tadpole larva was mapped cell by cell with electron microscopy. All {data.config.popSize + data.config.controlSize} brains share that wiring. Their genomes set synapse strengths, firing thresholds and transmitter signs.</p>
            <p>Each hour a brain senses the HYPE price and volume and runs for 32 integer steps. If right motor neurons dominate it buys, if left dominate it sells, otherwise it holds. All trades are on paper with a 3 bps fee.</p>
            <p>Every 24 hours the better half of the {data.config.popSize} selection specimens survives and breeds, by uniform crossover and 1% mutation. In the {data.config.controlSize} control specimens chance decides who survives. Fitness is return minus half the deepest drawdown.</p>
            <p>After {data.config.generations} generations both populations face a week they never saw. Statistics run across six independent replicates with an exact sign-flip test, because individuals in one population are relatives, not independent samples.</p>
      </details>

      <details className="more">
        <summary>Earlier test: not distinguishable from chance</summary>
        <p><b>Correction, 3 November 2026.</b> The first run used a public copy of the wiring whose outgoing connections carried the wrong cell names for 192 of 205 rows. The wiring now comes from the paper’s own matrix, and the run below was repeated on it. It reused the same week, so it is a corrected record and not a fresh test.</p>
        <p>Success requires selection to lead in all six replicates (one-sided p ≤ {data.alpha}). None of the three questions passed, nor did they pass the looser p &lt; 0.05. The threshold was fixed after these results were seen.</p>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Question</th><th className="num">Mean difference</th><th className="num">Replicates ahead</th><th className="num">p</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.q}><td>{r.q}</td><td className="num">{r.mean}</td><td className="num">{pos(r.xs)}/{r.xs.length}</td><td className="num">{r.p.toFixed(4)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="columns">
          <figure>
            <HoldoutPlot />
            <figcaption><b>Figure 2.</b> Unseen week, {data.data.holdoutFrom.slice(0, 10)} to {data.data.holdoutTo.slice(0, 10)}. Fitness in bps.</figcaption>
          </figure>
          <div>
            <h3>Why the means mislead</h3>
            <p>Beating control by {n(t.vsControl.meanBps)} bps is mostly not selection’s doing. In replicates 1, 2 and 4 control scored between −1,600 and −2,600 in a week when simply holding returned {n(t.buyHold)} bps. Selection itself stayed close to zero in those replicates.</p>
            <p>Beating no trading is uneven: selection was ahead in {pos(t.vsFlat.selectionBps)} of 6 replicates, and the difference was not significant.</p>
            <p>The week’s top scorer, specimen {data.bestSpecimen.id}, said buy in {w.buy} of 168 hours, sell in {w.sell}, hold in {w.hold}. Staying long in a rising week does not show it read the market.</p>
            <p>This unseen week was already used once, so these numbers are a correction, not new evidence.</p>
          </div>
        </div>
      </details>

      <details className="more">
        <summary>Limits</summary>
        <ul className="limits">
          <li>One unseen week was used. The result does not generalise to other market periods.</li>
          <li>That week has now been seen. If code or rules change, the test must use a new period.</li>
          <li>The map has {data.brain.cells.length} cells. The paper reports 177 neurons; the matrix also holds other cells. 169 cells are matched by name to the paper's table, including every sensory and motor cell used here; the remaining 47 are not yet matched.</li>
          <li>The link between Ant1 and Ant2 and gravity sensing is a proposal in the paper. Feeding them price is our choice, not a biological claim.</li>
          <li>The larva model is schematic. Network positions are not anatomical.</li>
          <li>Thoughts and genomes on this site can be recomputed for replicate 1. Other replicates publish their records without genomes in this preview.</li>
          <li>On chain, decisions, fitness and genome hashes will come from the runner. Anyone can recompute them from public data with the open verifier, and can recompute a single thought on the EVM. The contract does not enforce them.</li>
          <li>This experiment manages no funds and promises no returns. The contracts run on Elysium under protocol v0.2, locked before the run.</li>
        </ul>
      </details>

      <details className="more">
        <summary>Sources</summary>
        <p>Wiring: Ryan K, Lu Z, Meinertzhagen IA (2016), <a href="https://elifesciences.org/articles/16962">The CNS connectome of a tadpole larva of Ciona intestinalis</a>, eLife 5:e16962, CC BY 4.0, built from the paper's own connectivity matrix (Figure 16, source data 1). Market: Hyperliquid HYPE hourly candles. Run seed: {data.seed}.</p>
      </details>
    </article>
  );
}
