export default function Page() {
  return (
    <article className="screen paper">
      <header>
        <h1>Verify</h1>
        <p>You should not have to trust this site. A clean check shows the records match public inputs, not that the brains learned anything.</p>
      </header>

      <ol className="flow" aria-label="How a check works">
        <li><b>Public inputs</b><span>Seed, drand beacon, market candles</span></li>
        <li><b>Open code</b><span>Rebuilds each replicate on your machine</span></li>
        <li><b>The chain</b><span>Thoughts, scores, genomes, fossils</span></li>
        <li><b>Compare</b><span>Stops at the first mismatch and names it</span></li>
      </ol>

      <section>
        <h2>Status</h2>
        <p>The contracts run on Elysium, and anyone can recompute the record from public data. Run the command below from <a href="https://github.com/NotochordLabs/notochord/tree/48d6fbf">the locked code</a>, with the manifest in <code>site/public/live</code>.</p>
      </section>

      <details className="more">
        <summary>Who decides what</summary>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Record</th><th>Enforced by the contract</th><th>Recomputed by the verifier</th></tr></thead>
            <tbody>
              <tr><td>Order of steps and population sizes</td><td>Yes</td><td>Yes</td></tr>
              <tr><td>Best half survives, ties by lower id</td><td>Yes</td><td>Yes</td></tr>
              <tr><td>Randomness round chosen before it is published</td><td>Yes</td><td>Yes</td></tr>
              <tr><td>Randomness value matches drand</td><td>No</td><td>Yes</td></tr>
              <tr><td>Hourly decisions and market inputs</td><td>No</td><td>Yes</td></tr>
              <tr><td>Fitness scores</td><td>No</td><td>Yes</td></tr>
              <tr><td>Genome hashes and fossils</td><td>Fossil must match its hash</td><td>Yes</td></tr>
            </tbody>
          </table>
        </div>
        <p className="afterTable">Where the contract does not enforce a record, the runner could write a false one. It could not do so unnoticed, because anyone can recompute it from public data.</p>
      </details>

      <section>
        <h2>Check a run</h2>
        <p>You need the open code, the published manifest and any Elysium RPC. No wallet and no funds.</p>
        <pre className="command"><code>npm run runner:verify -- --manifest manifest.json</code></pre>
        <p>This rebuilds each replicate from its seed, the drand beacon and public market candles, then compares every recorded thought, score, genome and fossil. It stops a replicate at its first mismatch and names it.</p>
        <p>It also sends one thought per generation to ThoughtVerifier, a separate implementation of the brain in Solidity. Answering takes the EVM 6 to 13 million gas on the test cases, read for free with <code>eth_call</code>. ThoughtVerifier changes no experiment state and has no owner.</p>
      </section>

      <details className="more">
        <summary>Check the wiring</summary>
        <p>The wiring is built from the paper’s own connectivity matrix.</p>
        <pre className="command"><code>python3 scripts/build-connectome.py</code></pre>
        <p>The rebuilt files should match the fingerprints below.</p>
        <dl className="facts small hashes">
          <div><dt>nodes.csv</dt><dd><code>2f82acd4e076e9a69d052f5316d535afe0b46233fd70439cbe132ac48d2c365a</code></dd></div>
          <div><dt>edges.csv</dt><dd><code>5ba7d9aecfa6fef82195cbaca1b45a635d5ff2c53494dbc8a5fb7955588b4aba</code></dd></div>
        </dl>
      </details>

      <details className="more">
        <summary>Corrections</summary>
        <p><b>3 November 2026.</b> The first run used a public copy of the wiring in which 192 of 205 rows of outgoing connections carried the wrong cell’s name. We found it by comparing that copy with the paper’s matrix. The wiring was rebuilt from the paper and the run repeated. Results made on the old copy are withdrawn.</p>
      </details>

      <details className="more">
        <summary>What this cannot show</summary>
        <ul className="limits">
          <li>Verification shows the records are consistent with public inputs. It does not show that the brains learned anything. That is what the statistical test is for.</li>
          <li>The result depends on the market data published by Hyperliquid. The verifier checks the data used against that source, not that the source is right.</li>
          <li>Genesis and connection weights use floating-point functions, which can differ between JavaScript engines. Verify with the Node version named in the protocol.</li>
        </ul>
      </details>
    </article>
  );
}
