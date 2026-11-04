import Link from "next/link";
import { HoldoutPlot, TrainingPlot } from "@/components/Screens";
import data from "@/data/experiment.json";
import power from "@/data/power.json";

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const ahead = (xs: number[]) => xs.filter((x) => x > 0).length;

export default function Page() {
  const t = data.tests;
  const rows = [
    { q: "Selection against control, in training", mean: `${n(t.training.meanBps)} bps a day`, xs: t.training.diffsBps, p: t.training.p },
    { q: "Selection against control, unseen week", mean: `${n(t.vsControl.meanBps)} bps`, xs: t.vsControl.diffsBps, p: t.vsControl.p },
    { q: "Selection against not trading, unseen week", mean: `${n(t.vsFlat.meanBps)} bps`, xs: t.vsFlat.selectionBps, p: t.vsFlat.p },
  ];
  return (
    <article className="screen paper">
      <header>
        <h1>Report</h1>
        <p>What was asked, what was found, and what is still unknown. This report covers an earlier test on historical market data. The on-chain experiment began on 4 November 2026 and has no result yet.</p>
      </header>

      <section>
        <h2>The question</h2>
        <p>Can brains with the wiring of a <i>Ciona intestinalis</i> larva learn a market through natural selection alone? To count, selected brains must beat both a control group that survives by chance and simply not trading, on market data they never saw.</p>
      </section>

      <section>
        <h2>The answer so far: not shown</h2>
        <p>Selection did not clear the threshold of p ≤ {data.alpha}, set for all three comparisons. That does not prove the brains cannot learn. It means this measurement does not show that they did.</p>
        <figure className="reportFigure">
          <TrainingPlot />
          <figcaption><b>Figure 1.</b> Daily fitness added up over 100 generations, mean of six replicates. Simulation on historical data. Both groups lose, and the gap is not significant (p = {t.training.p.toFixed(3)}).</figcaption>
        </figure>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Comparison</th><th className="num">Mean difference</th><th className="num">Replicates ahead</th><th className="num">p</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.q}><td>{r.q}</td><td className="num">{r.mean}</td><td className="num">{ahead(r.xs)}/{r.xs.length}</td><td className="num">{r.p.toFixed(3)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="afterTable">The numbers are fitness: return minus half the deepest drawdown, after a 3 bps fee. Holding through the same week returned {n(t.buyHold)} bps, which is a return and not a fitness, so it does not compare directly.</p>
        <figure className="reportFigure">
          <HoldoutPlot />
          <figcaption><b>Figure 2.</b> Unseen week, {data.data.holdoutFrom.slice(0, 10)} to {data.data.holdoutTo.slice(0, 10)}. Fitness in bps.</figcaption>
        </figure>
      </section>

      <section>
        <h2>How to read it</h2>
        <ul className="limits">
          <li>The lead over control looks large, but most of it comes from control losing heavily in replicates 1, 2 and 4. Selection itself stayed near zero in those replicates.</li>
          <li>Against not trading, selection led in {ahead(t.vsFlat.selectionBps)} of 6 replicates, and the difference was not significant.</li>
          <li>This was one rising week. A result from a single week says little about other market periods, in either direction.</li>
          <li>This week had already been used once before the wiring was corrected, so these numbers are a correction and not a fresh test.</li>
        </ul>
      </section>

      <details className="more">
        <summary>What went wrong along the way</summary>
        <p>The first run used a public copy of the wiring in which outgoing connections carried the wrong cell’s name in 192 of 205 rows. Comparing it with the paper’s matrix exposed the error. The wiring now comes from the paper directly, and results made on the old copy are withdrawn. The details are on the <Link href="/verify/">Verify</Link> page.</p>
      </details>

      <details className="more">
        <summary>How much can this test see?</summary>
        <p>We planted a pattern in artificial markets: the next move repeats the last one’s direction with a set probability. Then we asked how often the full test passes, on {power.markets} separate markets. These markets are invented and say nothing about real ones.</p>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Next move repeats the last</th><th className="num">6 replicates</th><th className="num">12 replicates</th><th className="num">18 replicates</th><th className="num">6 replicates, 28 days</th></tr></thead>
            <tbody>{power.rows.map((r) => <tr key={r.pct}><td>{r.pct === 50 ? "50%, no pattern" : `${r.pct}%`}</td><td className="num">{r.six}/{power.markets}</td><td className="num">{r.twelve}/{power.markets}</td><td className="num">{r.eighteen}/{power.markets}</td><td className="num">{r.six28}/{power.markets}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="afterTable">The test raised no false alarm, though {power.markets} markets cannot pin that rate down. It passes reliably only for a pattern far stronger than we expect in a real market, and more replicates barely help. So “not shown” does not rule out a modest effect: this design could miss it.</p>
      </details>

      <details className="more">
        <summary>Does the larva’s wiring matter?</summary>
        <p>We repeated the study on randomised wiring: the same cells, inputs, outputs and weights, with connections shuffled. There is no sign yet that the real map learns better. On the strongest pattern, over 28 days, randomised wiring led on all 4 markets, by a mean of {n(-power.arm[2].realMinusShuffled)} bps. On the weaker pattern the real map led on {power.arm[1].marketsAhead} of 4. With 4 markets this is a description, not a test, and we do not know the cause yet.</p>
      </details>

      <section>
        <h2>What comes next</h2>
        <ul className="limits">
          <li>Protocol v0.2 was locked before the run. Its hash, 0x00dee041…d3a7, is recorded on chain.</li>
          <li>The experiment runs on Elysium for {data.config.generations} days, then faces 28 unseen days, with six replicates on the real map and six on shuffled wiring. This report will be published in the same form whatever the result.</li>
        </ul>
        <p className="afterTable">This experiment manages no funds and promises no returns.</p>
      </section>
    </article>
  );
}
