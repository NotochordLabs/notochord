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
import { deployReplicates, protocolHash, type Manifest } from "../runner/deploy";
import { HOUR, labFor, makeLab, PROTOCOL_RULES, type Rules } from "../runner/engine";
import { Replicate, type Ctx } from "../runner/replicate";
import { replayMarket, simulatedDrand, type Drand } from "../runner/sources";
import { deployThoughtVerifier } from "../runner/thought-verifier";
import { verifyRun } from "../runner/verify";

const hasData = existsSync("data/connectome/nodes.csv") && existsSync("data/prices-HYPE-1h.json");
const anvilBin = process.env.ANVIL_BIN ?? "anvil";
const hasAnvil = spawnSync(anvilBin, ["--version"]).status === 0;

test("the verifier accepts an honest run and catches altered inputs", { skip: !hasData || !hasAnvil, timeout: 400_000 }, async () => {
  const { candles } = JSON.parse(readFileSync("data/prices-HYPE-1h.json", "utf8"));
  const rules: Rules = { ...PROTOCOL_RULES, generations: 2, holdoutHours: 6 };
  const total = rules.generations * rules.hoursPerGeneration + rules.holdoutHours;
  const startMs: number = candles[candles.length - 1 - total].t;
  const port = 8602;
  const anvil = spawn(anvilBin, ["--port", String(port), "--silent", "--timestamp", String(startMs / 1000 - 7200)], { stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 800));
    const transport = http(`http://127.0.0.1:${port}`);
    const publicClient = createPublicClient({ chain: foundry, transport, pollingInterval: 20 }) as PublicClient;
    const wallet = createWalletClient({ chain: foundry, transport, pollingInterval: 20, account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") }) as WalletClient;
    const lab = makeLab(loadConnectome("data/connectome"));
    const hash = protocolHash();
    const replicates = await deployReplicates(publicClient, wallet, 1, rules, lab.layout.size, hash);
    const r = replicates[0];
    let clock = startMs - HOUR;
    const source = replayMarket(candles, "test");
    const ctx: Ctx = { lab, rules, seed: "verify-test", startMs, now: () => clock, drand: simulatedDrand, market: source, publicClient, wallet };
    const rep = new Replicate(ctx, 1, r.generation, r.fossil, join(mkdtempSync(join(tmpdir(), "notochord-")), "r1.json"));
    for (const end = startMs + (total + 2) * HOUR; clock <= end; clock += HOUR) {
      await publicClient.request({ method: "evm_mine" as never, params: [clock / 1000] as never });
      while (await rep.step());
    }
    const manifest: Manifest = { name: "t", chainId: 31337, simulated: true, coin: "HYPE", seed: "verify-test", startMs, rules, protocolHash: hash, replicates, verifier: await deployThoughtVerifier(publicClient, wallet, lab) };
    const now = clock;

    const honest = await verifyRun(publicClient, manifest, lab, simulatedDrand, source, now);
    assert.deepEqual(honest.problems, []);
    assert.equal(honest.checked.generations, 2);
    assert.equal(honest.checked.thoughts, 48);
    assert.equal(honest.checked.holdouts, 1);
    assert.ok(honest.checked.fossils > 0);
    assert.ok(honest.checked.genomes >= 160);
    assert.equal(honest.checked.evm, 2);

    const wrongSeed = await verifyRun(publicClient, { ...manifest, seed: "other" }, lab, simulatedDrand, source, now);
    assert.match(wrongSeed.problems.join(), /genom/);

    const altered = candles.map((k: { t: number; c: number; v: number }) => (k.t === startMs + 5 * HOUR ? { ...k, c: k.c * 1.01 } : k));
    const wrongMarket = await verifyRun(publicClient, manifest, lab, simulatedDrand, replayMarket(altered, "test"), now);
    assert.match(wrongMarket.problems.join(), /market input/);

    const fakeBeacon: Drand = { get: async () => `0x${"ab".repeat(32)}` };
    const wrongDrand = await verifyRun(publicClient, manifest, lab, fakeBeacon, source, now);
    assert.match(wrongDrand.problems.join(), /drand/);

    const wrongWiring = await verifyRun(publicClient, { ...manifest, protocolHash: `0x${"11".repeat(32)}` }, lab, simulatedDrand, source, now);
    assert.match(wrongWiring.problems.join(), /protocol hash/);
  } finally {
    anvil.kill();
  }
});

test("a replicate on shuffled wiring is recorded and verified with its own wiring", { skip: !hasData || !hasAnvil, timeout: 300_000 }, async () => {
  const { candles } = JSON.parse(readFileSync("data/prices-HYPE-1h.json", "utf8"));
  const rules: Rules = { ...PROTOCOL_RULES, generations: 1, holdoutHours: 6 };
  const total = 24 + 6;
  const startMs: number = candles[candles.length - 1 - total].t;
  const port = 8603;
  const anvil = spawn(anvilBin, ["--port", String(port), "--silent", "--timestamp", String(startMs / 1000 - 7200)], { stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 800));
    const transport = http(`http://127.0.0.1:${port}`);
    const publicClient = createPublicClient({ chain: foundry, transport, pollingInterval: 20 }) as PublicClient;
    const wallet = createWalletClient({ chain: foundry, transport, pollingInterval: 20, account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") }) as WalletClient;
    const lab = makeLab(loadConnectome("data/connectome"));
    const [a] = await deployReplicates(publicClient, wallet, 1, rules, lab.layout.size, protocolHash());
    const r = { ...a, wiring: "shuffled" as const };
    let clock = startMs - HOUR;
    const source = replayMarket(candles, "test");
    const ctx: Ctx = { lab: labFor(lab, "arm", r), rules, seed: "arm", startMs, now: () => clock, drand: simulatedDrand, market: source, publicClient, wallet };
    const rep = new Replicate(ctx, r.index, r.generation, r.fossil, join(mkdtempSync(join(tmpdir(), "notochord-")), "r.json"));
    for (const end = startMs + (total + 2) * HOUR; clock <= end; clock += HOUR) {
      await publicClient.request({ method: "evm_mine" as never, params: [clock / 1000] as never });
      while (await rep.step());
    }
    const manifest: Manifest = { name: "t", chainId: 31337, simulated: true, coin: "HYPE", seed: "arm", startMs, rules, protocolHash: protocolHash(), replicates: [r] };
    const ok = await verifyRun(publicClient, manifest, lab, simulatedDrand, source, clock);
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.checked.generations, 1);
    const asReal = await verifyRun(publicClient, { ...manifest, replicates: [a] }, lab, simulatedDrand, source, clock);
    assert.ok(asReal.problems.length > 0, "real wiring must not reproduce a shuffled replicate");
  } finally {
    anvil.kill();
  }
});
