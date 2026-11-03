import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { loadConnectome } from "../src/connectome";
import { DEFAULTS } from "../src/experiment";
import { loadMarket, score } from "../src/market";
import { deployReplicates } from "../runner/deploy";
import { chainHash, closeGeneration, createPopulation, everyone, HOUR, makeLab, PROTOCOL_RULES, thoughtBytes, type Rules } from "../runner/engine";
import { Replicate, type Ctx } from "../runner/replicate";
import { readResults } from "../runner/report";
import { replayMarket, roundAt, simulatedDrand, DRAND } from "../runner/sources";

const hasData = existsSync("data/connectome/nodes.csv") && existsSync("data/prices-HYPE-1h.json");
const anvilBin = process.env.ANVIL_BIN ?? "anvil";
const hasAnvil = spawnSync(anvilBin, ["--version"]).status === 0;
const FIXTURE = "contracts/test/fixtures/r1-gen0-10.json";

test("the engine breeds the same populations as the offline simulator", { skip: !hasData }, () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const lab = makeLab(loadConnectome("data/connectome"));
  const m = loadMarket("data/prices-HYPE-1h.json");
  const holdoutStart = m.candles.length - 1 - DEFAULTS.holdoutHours;
  const trainStart = holdoutStart - DEFAULTS.generations * DEFAULTS.hoursPerGeneration;
  const seed = "experiment-177-001/r1";

  let p = createPopulation(lab, seed, null, PROTOCOL_RULES);
  assert.deepEqual(p.selection.map(chainHash), fixture.genesis.selection);
  for (let g = 0; g < 10; g++) {
    const c = closeGeneration(lab, p, m, trainStart + g * 24, seed, null, PROTOCOL_RULES);
    assert.deepEqual(c.selectionFitness, fixture.generations[g].selectionFitness);
    assert.deepEqual(c.controlEliminated, fixture.generations[g].controlEliminated);
    p = c.next!;
  }
  assert.deepEqual(p.selection.map((s) => s.id), fixture.final.selectionIds);
  assert.deepEqual(p.control.map((s) => s.id), fixture.final.controlIds);
  const sample = p.selection.find((s) => s.id === fixture.final.sampleId)!;
  assert.equal(chainHash(sample), fixture.final.sampleHash);
});

test("hourly decisions agree with the decisions fitness is scored on", { skip: !hasData }, () => {
  const lab = makeLab(loadConnectome("data/connectome"));
  const m = loadMarket("data/prices-HYPE-1h.json");
  const p = createPopulation(lab, "decisions", "0x01", PROTOCOL_RULES);
  const start = 100;
  for (const [k, s] of everyone(p).entries()) {
    const scored = new Int8Array(24);
    score(lab.connectome, lab.roles, s.brain, m, start, 24, lab.scratch, scored);
    for (let h = 0; h < 24; h++) {
      const recorded = thoughtBytes(lab, { ...p, selection: [s], control: [] }, m, start + h).decisions[0];
      assert.equal(recorded, scored[h] === 1 ? 1 : scored[h] === -1 ? 2 : 0, `specimen ${k}, hour ${h}`);
    }
  }
});

test("drand rounds map to the first publication at or after a time", () => {
  const t = (DRAND.genesisTime + 3000) * 1000;
  assert.equal(roundAt(t), 1001n);
  assert.equal(roundAt(t + 1), 1002n);
});

test("a run on a local chain survives a crash at every kind of transaction", { skip: !hasData || !hasAnvil, timeout: 300_000 }, async () => {
  const { candles } = JSON.parse(readFileSync("data/prices-HYPE-1h.json", "utf8"));
  const rules: Rules = { ...PROTOCOL_RULES, generations: 2, holdoutHours: 6 };
  const total = rules.generations * rules.hoursPerGeneration + rules.holdoutHours;
  const startMs: number = candles[candles.length - 1 - total].t;
  const port = 8601;
  const anvil = spawn(anvilBin, ["--port", String(port), "--silent", "--timestamp", String(startMs / 1000 - 7200)], { stdio: "ignore" });
  try {
    const url = `http://127.0.0.1:${port}`;
    await new Promise((r) => setTimeout(r, 800));
    const transport = http(url);
    const publicClient = createPublicClient({ chain: foundry, transport, pollingInterval: 20 }) as PublicClient;
    const wallet = createWalletClient({
      chain: foundry,
      transport,
      pollingInterval: 20,
      account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"),
    }) as WalletClient;
    const lab = makeLab(loadConnectome("data/connectome"));
    const [r] = await deployReplicates(publicClient, wallet, 1, rules, lab.layout.size, `0x${"11".repeat(32)}`);

    let clock = startMs - HOUR;
    const crashed = new Set<string>();
    const ctx: Ctx = {
      lab,
      rules,
      seed: "crash-test",
      startMs,
      now: () => clock,
      drand: simulatedDrand,
      market: replayMarket(candles, "test"),
      publicClient,
      wallet,
      beforeSend: (fn) => {
        if (!crashed.has(fn)) {
          crashed.add(fn);
          throw new Error(`simulated crash before ${fn}`);
        }
      },
    };
    const path = join(mkdtempSync(join(tmpdir(), "notochord-")), "r1.json");
    const end = startMs + (total + 2) * HOUR;
    for (; clock <= end; clock += HOUR) {
      await publicClient.request({ method: "evm_mine" as never, params: [clock / 1000] as never });
      for (;;) {
        // A new object each time: nothing but the state file and the chain survives.
        const rep = new Replicate(ctx, 1, r.generation, r.fossil, path);
        try {
          if (!(await rep.step())) break;
        } catch (e) {
          assert.match((e as Error).message, /simulated crash/);
        }
      }
    }
    for (const fn of ["commitGenesis", "recordGenesis", "open", "recordThought", "close", "record", "recordHoldout"]) {
      assert.ok(crashed.has(fn), `${fn} was not exercised`);
    }
    const results = await readResults(publicClient, [r.generation]);
    assert.equal(results.generations, 2);
    assert.equal(results.holdoutVsFlat.length, 1);
  } finally {
    anvil.kill();
  }
});
