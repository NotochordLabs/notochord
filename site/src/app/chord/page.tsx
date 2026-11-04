import type { Metadata } from "next";
import Link from "next/link";
import TokenAddress from "@/components/TokenAddress";
import { TOKEN } from "@/data/token";

export const metadata: Metadata = {
  title: "$CHORD",
  description: "What the $CHORD token is, what it does not do, and how it relates to Experiment 177.",
};

export default function Page() {
  const facts: [string, string | null][] = [
    ["Network", TOKEN.network],
  ];
  return (
    <article className="chord">
      <header className="chordHero">
        <div>
          <h1>{TOKEN.ticker}</h1>
          <p>The token of the Notochord experiment, a public test of whether a Ciona brain can learn the market.</p>
        </div>
        <img src="/neuron.jpg" alt="" width={720} height={720} />
      </header>

      <section className="chordAddress">
        <h2>Contract address</h2>
        {TOKEN.address ? (
          <>
            <TokenAddress address={TOKEN.address} />
            <p>This is the only official address.{TOKEN.explorerUrl && <> <a href={TOKEN.explorerUrl} target="_blank" rel="noreferrer">View on the explorer</a>.</>}</p>
          </>
        ) : (
          <>
            <strong>Not launched yet</strong>
            <p>Any token using this name today is not ours. The official address will appear here.</p>
          </>
        )}
      </section>

      <section className="chordUse">
        <div>
          <h2>Use it in the Lab</h2>
          <p>{TOKEN.ticker} breeds new brains. Pick two parents from the experiment’s fossils or earlier Lab brains and burn {TOKEN.ticker}. Your brain is born the next day, then races 24 hours of live HYPE on paper, on the public record.</p>
          <Link className="chordCta" href="/lab/">Open the Lab</Link>
        </div>
        <dl>
          <div><dt>Cost per brain</dt><dd>10,000 {TOKEN.ticker}</dd></div>
          <div><dt>Brains per day</dt><dd>200 at most</dd></div>
          <div><dt>Prizes</dt><dd>None</dd></div>
        </dl>
      </section>

      <div className="chordTruth">
        <section>
          <h2>Burned for good</h2>
          <p>Each breeding sends {TOKEN.ticker} straight to the dead address in the same transaction. The Lab holds no tokens. The cost and the daily limit are fixed in its contract.</p>
        </section>
        <section>
          <h2>Independent science</h2>
          <p>Lab brains never enter Experiment 177. The Lab only reads its fossils, and no token can change the experiment’s rules or its result.</p>
        </section>
      </div>

      <section className="chordFacts">
        <h2>Token details</h2>
        <dl>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={value ? undefined : "pending"}>{value ?? "To be published"}</dd>
            </div>
          ))}
        </dl>
        <p>The experiment’s wallet is separate from every token wallet.</p>
        <p className="chordNotice">{TOKEN.ticker} is not an investment and promises no returns. It gives no claim on funds or revenue, and its value can fall. A Lab brain’s race says nothing about the market or about the experiment. The experiment’s outcome is open: the test so far reports market learning not shown. <Link href="/report/">Read the report</Link>.</p>
      </section>
    </article>
  );
}
