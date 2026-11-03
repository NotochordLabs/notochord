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
          <p>The token of the Notochord experiment. It cannot change the science.</p>
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
          <h2>What it does</h2>
          <p>Nothing yet. Holding it gives you no access, vote or service.</p>
          <p><span>Proposed, not built:</span> funding later experiments, and voting on what the next one tests. If either ships, this page will say so.</p>
        </section>
        <section>
          <h2>What it will not do</h2>
          <ul>
            <li>Change the experiment’s rules, data or result</li>
            <li>Give a claim on funds, fees or revenue</li>
            <li>Make you the owner of a larva</li>
            <li>Show, through its price, whether the brains learned</li>
          </ul>
        </section>
      </div>

      <section className="chordRisk">
        <h2>Do not buy it expecting a return</h2>
        <p>It can lose all of its value. The experiment may also fail: the test so far reports market learning not shown, and it has not yet started on chain under final rules. <Link href="/report/">Read the report</Link> or <Link href="/protocol/">the protocol</Link>.</p>
      </section>

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
      </section>
    </article>
  );
}
