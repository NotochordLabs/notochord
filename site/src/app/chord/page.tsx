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
    ["Total supply", TOKEN.totalSupply],
    ["Team share", TOKEN.teamShare],
    ["Liquidity", TOKEN.liquidity],
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

      <div className="chordTruth">
        <section>
          <h2>Utility</h2>
          <p>Use cases for {TOKEN.ticker} are planned and will be announced on this page. They are not live yet.</p>
        </section>
        <section>
          <h2>Independent science</h2>
          <p>The experiment’s rules are public and no token can change them, so anyone can check its result, whatever it is.</p>
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
        <p className="chordNotice">{TOKEN.ticker} is not an investment and promises no returns. It gives no claim on funds or revenue, and its value can fall. The experiment’s outcome is open: the test so far reports market learning not shown. <Link href="/report/">Read the report</Link>.</p>
      </section>
    </article>
  );
}
