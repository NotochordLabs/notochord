import type { Metadata } from "next";
import Link from "next/link";
import TokenAddress from "@/components/TokenAddress";
import { TOKEN } from "@/data/token";

export const metadata: Metadata = {
  title: "$CHORD",
  description: "What the $CHORD token is, what it does not do, and how it relates to Experiment 177.",
};

const PENDING = "Not published yet";

export default function Page() {
  const facts: [string, string | null][] = [
    ["Network", TOKEN.network],
    ["Total supply", TOKEN.totalSupply],
    ["Team share", TOKEN.teamShare],
    ["Liquidity", TOKEN.liquidity],
  ];
  return (
    <article className="screen paper">
      <header>
        <h1>{TOKEN.ticker}</h1>
        <p>The token associated with Notochord. It has no effect on the experiment.</p>
      </header>

      <section>
        <h2>Contract address</h2>
        {TOKEN.address ? (
          <>
            <TokenAddress address={TOKEN.address} />
            {TOKEN.explorerUrl && <p className="afterTable"><a href={TOKEN.explorerUrl} target="_blank" rel="noreferrer">View on the explorer</a></p>}
            <p className="afterTable">This is the only official address. Check it here before you interact with any token using this name.</p>
          </>
        ) : (
          <p>There is no {TOKEN.ticker} token yet. Any token using this name now is not ours. The official address will appear on this page.</p>
        )}
      </section>

      <section>
        <h2>What it does</h2>
        <p>It has no function today. Holding it gives you no access, vote or service.</p>
        <p>We have proposed two uses: funding later experiments, and voting on what the next experiment tests. Neither is built, and neither is a promise. If one ships, this page will say so.</p>
      </section>

      <section>
        <h2>What it does not do</h2>
        <ul className="limits">
          <li>It cannot change the experiment. Holders have no say in its rules, its data or its result.</li>
          <li>It gives no claim on any funds, fees or revenue. The experiment manages no funds and trades only on paper.</li>
          <li>It does not own a larva. The specimens belong to nobody.</li>
          <li>Its price does not measure whether the brains learned anything.</li>
        </ul>
      </section>

      <section>
        <h2>The risks</h2>
        <p>Do not buy {TOKEN.ticker} expecting a return. It can lose all of its value, and nobody is promising otherwise.</p>
        <p>The experiment may fail. The test so far, on data already seen, reports market learning not shown. That may also be the final result, and it will be published in the same form. <Link href="/report/">Read the report</Link>.</p>
      </section>

      <section>
        <h2>The experiment’s status</h2>
        <p>The experiment has not started on chain, and its rules are still a draft. Everything the charts on this site show is a simulation on historical data. <Link href="/protocol/">Read the protocol</Link>.</p>
      </section>

      <section>
        <h2>Token details</h2>
        <div className="tableWrap">
          <table>
            <tbody>
              {facts.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value ?? PENDING}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="afterTable">The experiment’s wallet is separate from every token wallet.</p>
      </section>
    </article>
  );
}
