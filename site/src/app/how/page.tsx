import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description: "How Notochord turns the mapped wiring of a Ciona larva into brains that face the market, in four steps.",
};

const Y = [34, 30, 36, 26, 30, 20, 24, 14, 20, 10];

function Market() {
  return (
    <svg viewBox="0 0 200 110" aria-hidden="true">
      <polyline points={Y.map((v, i) => `${10 + i * 20},${v * 2 + 8}`).join(" ")} fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="190" cy="28" r="5" fill="var(--cyan)" />
      {Y.map((v, i) => <rect key={i} x={7 + i * 20} y={102 - v / 2} width="7" height={v / 2} rx="1.5" fill="var(--dapi)" opacity="0.7" />)}
    </svg>
  );
}

const SENSORS = [20, 45, 70, 95];
const MIDDLE: [number, number][] = [[80, 15], [76, 45], [86, 72], [78, 98], [122, 30], [126, 60], [120, 90]];

function Wiring() {
  return (
    <svg viewBox="0 0 200 110" aria-hidden="true">
      {SENSORS.flatMap((y, i) => MIDDLE.slice(0, 4).map(([x, m], j) => <line key={`a${i}${j}`} x1="18" y1={y} x2={x} y2={m} stroke="var(--line)" />))}
      {MIDDLE.slice(0, 4).flatMap(([x, m], i) => MIDDLE.slice(4).map(([x2, m2], j) => <line key={`b${i}${j}`} x1={x} y1={m} x2={x2} y2={m2} stroke={(i + j) % 2 ? "var(--cherry)" : "var(--line)"} opacity={(i + j) % 2 ? 0.75 : 1} />))}
      {MIDDLE.slice(4).flatMap(([x, m], i) => [28, 82].map((y, j) => <line key={`c${i}${j}`} x1={x} y1={m} x2="184" y2={y} stroke="var(--line)" />))}
      {SENSORS.map((y) => <circle key={y} cx="18" cy={y} r="5" fill="var(--dapi)" />)}
      {MIDDLE.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.5" fill={i % 3 === 0 ? "#fff" : "var(--cherry)"} />)}
      {[28, 82].map((y) => <circle key={y} cx="184" cy={y} r="6" fill="var(--gfp)" />)}
    </svg>
  );
}

function Decision() {
  return (
    <svg viewBox="0 0 200 110" aria-hidden="true">
      <text x="12" y="30" fill="var(--muted)" fontSize="13">Left, sell</text>
      <rect x="12" y="38" width="176" height="11" rx="5.5" fill="var(--panel2)" />
      <rect x="12" y="38" width="38" height="11" rx="5.5" fill="var(--cherry)" />
      <text x="12" y="74" fill="var(--muted)" fontSize="13">Right, buy</text>
      <rect x="12" y="82" width="176" height="11" rx="5.5" fill="var(--panel2)" />
      <rect x="12" y="82" width="132" height="11" rx="5.5" fill="var(--gfp)" />
    </svg>
  );
}

function Selection() {
  const dots = Array.from({ length: 32 }, (_, i) => i);
  return (
    <svg viewBox="0 0 200 110" aria-hidden="true">
      {dots.map((i) => {
        const x = 16 + (i % 8) * 24, y = 16 + Math.floor(i / 8) * 26;
        const alive = i < 16;
        return <circle key={i} cx={x} cy={y} r="7.5" fill={alive ? "var(--gfp)" : "none"} stroke={alive ? "none" : "var(--muted)"} strokeDasharray={alive ? undefined : "2 3"} opacity={alive ? 1 : 0.7} />;
      })}
    </svg>
  );
}

const STEPS = [
  { title: "A brain senses the market", art: <Market />, text: "Once an hour, each brain receives the direction of the HYPE price and its trading volume. They arrive at sensory cells of the larva’s brain. Which cells get which signal was our choice, not biology." },
  { title: "The signal travels the real wiring", art: <Wiring />, text: "The signal spreads for 32 steps through 216 cells and 3,010 connections, mapped from a real larva. A cell that receives enough signal fires, and excites or inhibits the cells it connects to." },
  { title: "The motor neurons decide", art: <Decision />, text: "The two sides of the motor neurons race. If the right side wins, the brain buys. If the left wins, it sells. If neither wins, it holds. These are paper trades." },
  { title: "Selection does the rest", art: <Selection />, text: "After 24 hours, the better half survives and has offspring with small mutations. The rest are removed. A control group follows the same rules, except chance decides who survives. This repeats for 100 generations." },
];

const FAQ = [
  ["Is this an AI agent?", "No. There is no language model, plan or reasoning. Each brain is a small, fixed network that turns inputs into a decision."],
  ["Does a brain learn?", "Not during its life. Its connection strengths are written in its genome and never change. Any improvement comes across generations, through selection."],
  ["How do we know whether it worked?", "After 100 generations, the brains face 28 days of market data they have never seen. To pass, selection must beat both the control group and simply not trading, across six independent replicates."],
  ["Has it worked so far?", "Unknown. The on-chain run has only begun. An earlier test, on data already seen once, did not clear the threshold. The final result will be published in the same form, whichever way it goes."],
  ["What does the blockchain do?", "It keeps the public record. Decisions, survivors and genomes are written to Elysium, and the randomness comes from drand, so anyone can recompute the run and check it."],
  ["Is real money traded?", "No. The experiment manages no funds, and its trades exist only on paper."],
] as const;

export default function Page() {
  return (
    <article className="how">
      <header>
        <h1>A larva’s brain, a market, and natural selection</h1>
        <p>The tadpole larva of the sea squirt <i>Ciona intestinalis</i> had its nervous system mapped cell by cell. We build artificial brains on that map, and ask one question: can selection teach them the market?</p>
      </header>
      <ol className="howSteps">
        {STEPS.map((s) => (
          <li key={s.title}>
            <div className="howArt">{s.art}</div>
            <div><h2>{s.title}</h2><p>{s.text}</p></div>
          </li>
        ))}
      </ol>
      <section className="howFaq">
        <h2>Common questions</h2>
        {FAQ.map(([q, a]) => <details className="more" key={q} open={q === "Has it worked so far?"}><summary>{q}</summary><p>{a}</p></details>)}
      </section>
      <nav className="howNext">
        <Link href="/">See the brain</Link>
        <Link href="/test-run/">Watch the test run</Link>
        <Link href="/report/">Read the report</Link>
      </nav>
    </article>
  );
}
