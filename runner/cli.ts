import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, fallback, http, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConnectome } from "../src/connectome";
import { deployReplicates, protocolHash, type Manifest } from "./deploy";
import { HOUR, labFor, makeLab, PROTOCOL_RULES, type Rules } from "./engine";
import { deploymentProblems, loadProtocol } from "./protocol";
import { Replicate, type Ctx } from "./replicate";
import { formatResults, readResults } from "./report";
import { verifyRun } from "./verify";
import { deployThoughtVerifier } from "./thought-verifier";
import { health } from "./health";
import { DRAND, hyperliquidMarket, liveDrand, replayMarket, simulatedDrand } from "./sources";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const num = (name: string, fallbackValue: number) => (arg(name) !== undefined ? Number(arg(name)) : fallbackValue);

const ELYSIUM_CHAIN_ID = 99901;
/** rpc.chainzy.io answers reads and returns a hash for writes, but the transaction never reached the chain (3 Nov 2026). */
const DEFAULT_RPCS = ["https://rpc.betweenquotes.xyz"];
/** anvil's public test key #0. Never holds real funds. */
const ANVIL_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const LOCAL_CHAIN_ID = 31337;

const rpcUrls = () => (process.env.RPC_URLS ? process.env.RPC_URLS.split(",") : DEFAULT_RPCS);

function clients(urls: string[], chainId: number, key: Hex, pollingInterval: number) {
  const chain = defineChain({
    id: chainId,
    name: chainId === ELYSIUM_CHAIN_ID ? "Elysium" : "Local",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: { default: { http: urls } },
  });
  // Sending can be slow on a busy sequencer; a resend of the same nonce is harmless.
  const transport = fallback(urls.map((u) => http(u, { timeout: 90_000 })));
  const publicClient = createPublicClient({ chain, transport, pollingInterval }) as PublicClient;
  const wallet = createWalletClient({ chain, transport, account: privateKeyToAccount(key), pollingInterval }) as WalletClient;
  return { publicClient, wallet };
}

/** Real transactions need the key and an explicit statement of which chain is meant. */
function liveKey(): Hex {
  const key = process.env.RUNNER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("RUNNER_PRIVATE_KEY is not set.");
  if (process.env.NOTOCHORD_LIVE !== String(ELYSIUM_CHAIN_ID)) {
    throw new Error(`Writing to the real network needs NOTOCHORD_LIVE=${ELYSIUM_CHAIN_ID}.`);
  }
  return key;
}

const manifestPath = (name: string) => join("runner", "state", name, "manifest.json");
const statePath = (name: string, k: number) => join("runner", "state", name, `r${k}.json`);

/** Replicates after the first `real` are the comparison arm on randomised wiring. */
const markShuffled = <T extends { index: number }>(reps: T[], real: number) =>
  reps.map((r, i) => (i < real ? r : { ...r, wiring: "shuffled" as const }));

function rulesFromArgs(): Rules {
  return { ...PROTOCOL_RULES, generations: num("generations", PROTOCOL_RULES.generations), holdoutHours: num("holdout", PROTOCOL_RULES.holdoutHours) };
}

/* ---- replay: the full experiment against a throwaway local chain ---- */

async function waitForRpc(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("anvil did not start.");
}

export async function replay() {
  const rules = rulesFromArgs();
  const count = num("replicates", 6);
  const shuffled = num("shuffled", 6);
  const seed = arg("seed") ?? "replay-001";
  const coin = arg("coin") ?? "HYPE";
  const pricePath = join("data", `prices-${coin}-1h.json`);
  if (!existsSync(pricePath)) throw new Error(`${pricePath} is missing. Run npm run fetch first.`);
  const { candles } = JSON.parse(readFileSync(pricePath, "utf8")) as { candles: { t: number; c: number; v: number }[] };
  const totalHours = rules.generations * rules.hoursPerGeneration + rules.holdoutHours;
  const startIndex = candles.length - 1 - totalHours;
  if (startIndex < 24) throw new Error("Not enough data for this many generations.");
  const startMs = candles[startIndex].t;

  const port = num("port", 8599);
  const url = `http://127.0.0.1:${port}`;
  const bin = process.env.ANVIL_BIN ?? "anvil";
  const anvil = spawn(bin, ["--port", String(port), "--silent", "--timestamp", String(startMs / 1000 - 7200), "--order", "fifo", "--prune-history"], { stdio: "ignore" });
  const anvilFailed = new Promise<never>((_, reject) =>
    anvil.once("error", () => reject(new Error(`${bin} not found. Is Foundry installed?`))),
  );
  try {
    await Promise.race([waitForRpc(url), anvilFailed]);
    const { publicClient, wallet } = clients([url], LOCAL_CHAIN_ID, ANVIL_KEY, 20);
    const lab = makeLab(loadConnectome(join("data", "connectome")));
    const hash = protocolHash();
    const replicates = markShuffled(await deployReplicates(publicClient, wallet, count + shuffled, rules, lab.layout.size, hash), count);

    const name = arg("name") ?? `replay-${Date.now()}`;
    const dir = join("runner", "state", name);
    mkdirSync(dir, { recursive: true });
    const manifest: Manifest = { name, chainId: LOCAL_CHAIN_ID, simulated: true, coin, seed, startMs, rules, protocolHash: hash, replicates };
    writeFileSync(manifestPath(name), JSON.stringify(manifest, null, 2));

    let clock = startMs - HOUR;
    const gas = new Map<string, { calls: number; gas: bigint }>();
    const ctx: Ctx = {
      lab,
      rules,
      seed,
      startMs,
      now: () => clock,
      drand: simulatedDrand,
      market: replayMarket(candles, `Hyperliquid ${coin} 1h`),
      publicClient,
      wallet,
      onGas: (fn, used) => {
        const row = gas.get(fn) ?? { calls: 0, gas: 0n };
        row.calls++;
        row.gas += used;
        gas.set(fn, row);
      },
    };
    const reps = replicates.map((r) => new Replicate({ ...ctx, lab: labFor(lab, seed, r) }, r.index, r.generation, r.fossil, statePath(name, r.index)));

    const endMs = startMs + (totalHours + 2) * HOUR;
    const t0 = Date.now();
    for (; clock <= endMs; clock += HOUR) {
      // eth_call reads the latest block's time, so the clock moves by mining a block.
      await publicClient.request({ method: "evm_mine" as never, params: [clock / 1000] as never });
      for (const rep of reps) while (await rep.step());
      const hour = (clock - startMs) / HOUR;
      if (hour >= 0 && hour % 240 === 0) console.log(`  simulated hour ${hour}/${totalHours} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }

    const report = formatResults(await readResults(publicClient, replicates.filter((r) => !r.wiring).map((r) => r.generation)), true);
    console.log(report);
    console.log(`\nGas (total for ${reps.length} replicates, ${rules.generations} generations; excluding deployment and calldata fees):`);
    let total = 0n;
    for (const [fn, row] of [...gas].sort()) {
      total += row.gas;
      console.log(`  ${fn.padEnd(14)} ${String(row.calls).padStart(6)} txs  ${row.gas} gas`);
    }
    console.log(`  total ${total} gas · at 0.1 gwei ${Number(total) * 1e8 / 1e18} HYPE`);
    writeFileSync(join(dir, "report.txt"), report + "\n");
    return { report, total, publicClient };
  } finally {
    anvil.kill();
  }
}

/* ---- live ---- */

function liveCtx(manifest: Manifest): { ctx: Ctx; reps: Replicate[] } {
  if (manifest.simulated) throw new Error("This record is a simulation.");
  const { publicClient, wallet } = clients(rpcUrls(), manifest.chainId, liveKey(), 2000);
  const ctx: Ctx = {
    lab: makeLab(loadConnectome(join("data", "connectome"))),
    rules: manifest.rules,
    seed: manifest.seed,
    startMs: manifest.startMs,
    now: () => Date.now(),
    drand: liveDrand,
    market: hyperliquidMarket(manifest.coin),
    publicClient,
    wallet,
    onGas: (fn, used, fee) => console.log(`${new Date().toISOString()} ${fn} gas=${used} fee=${Number(fee) / 1e18} HYPE`),
  };
  return { ctx, reps: manifest.replicates.map((r) => new Replicate({ ...ctx, lab: labFor(ctx.lab, manifest.seed, r) }, r.index, r.generation, r.fossil, statePath(manifest.name, r.index))) };
}

async function deployLive() {
  const name = arg("name");
  if (!name) throw new Error("--name is required.");
  if (existsSync(manifestPath(name))) throw new Error(`${name} is already deployed.`);
  const rules = rulesFromArgs();
  const count = num("replicates", 6);
  const shuffled = num("shuffled", 6);
  const protocol = loadProtocol();
  const problems = deploymentProblems({ name, rules, main: count, shuffled, coin: arg("coin") ?? protocol.market.coin, seed: arg("seed"), nodeVersion: process.version }, protocol);
  if (problems.length) throw new Error(`Deployment stopped:\n  ${problems.join("\n  ")}`);
  const { publicClient, wallet } = clients(rpcUrls(), ELYSIUM_CHAIN_ID, liveKey(), 2000);
  const lab = makeLab(loadConnectome(join("data", "connectome")));
  const hash = protocolHash();

  // Written after each replicate: a failed deployment resumes instead of paying again.
  const dir = join("runner", "state", name);
  const progressPath = join(dir, "deploy-progress.json");
  mkdirSync(dir, { recursive: true });
  const saved = existsSync(progressPath) ? (JSON.parse(readFileSync(progressPath, "utf8")) as { protocolHash: Hex; deployBlock: string; replicates: Manifest["replicates"]; verifier?: Address }) : null;
  if (saved && saved.protocolHash !== hash) throw new Error(`An unfinished deployment was started with different code: ${progressPath}`);
  const balance = await publicClient.getBalance({ address: wallet.account!.address });
  console.error(`Wallet ${wallet.account!.address}, balance ${Number(balance) / 1e18} HYPE`);
  const deployBlock = saved?.deployBlock ?? String(await publicClient.getBlockNumber());
  const progress = { protocolHash: hash, deployBlock, replicates: saved?.replicates ?? [], verifier: saved?.verifier };
  const persist = () => writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  if (progress.replicates.length) console.error(`Resuming: ${progress.replicates.length} replicates already deployed.`);
  persist();
  const total = count + shuffled;
  progress.replicates = await deployReplicates(publicClient, wallet, total, rules, lab.layout.size, hash, progress.replicates, (done) => {
    progress.replicates = done;
    persist();
    console.error(`Replicate ${done.length}/${total} deployed.`);
  });
  progress.verifier ??= await deployThoughtVerifier(publicClient, wallet, lab);
  persist();
  console.error("ThoughtVerifier deployed.");
  // Fixed last, so a slow deployment cannot eat into the time left before the start.
  const startMs = (Math.floor(Date.now() / HOUR) + 2) * HOUR;
  const manifest: Manifest = { verifier: progress.verifier, name, chainId: ELYSIUM_CHAIN_ID, simulated: false, coin: arg("coin") ?? protocol.market.coin, seed: arg("seed") ?? (name.startsWith("test-") ? `experiment-177-chain-${name}` : protocol.seed), startMs, rules, protocolHash: hash, replicates: markShuffled(progress.replicates, count), deployBlock };
  writeFileSync(manifestPath(name), JSON.stringify(manifest, null, 2));
  rmSync(progressPath, { force: true });
  console.log(JSON.stringify(manifest, null, 2));
  console.error(`Start: ${new Date(startMs).toISOString()}. The runner must be started BEFORE this time, or the deployment is wasted.`);
}

async function runLive() {
  const name = arg("name");
  if (!name) throw new Error("--name is required.");
  const manifest = JSON.parse(readFileSync(manifestPath(name), "utf8")) as Manifest;
  const { reps } = liveCtx(manifest);
  const heartbeat = join("runner", "state", name, "heartbeat");
  for (;;) {
    writeFileSync(heartbeat, new Date().toISOString());
    for (const rep of reps) {
      try {
        while (await rep.step());
      } catch (e) {
        // One failing replicate or RPC must not stop the others; the chain says where to resume.
        console.error(`${new Date().toISOString()} replicate ${rep.index}: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

/* ---- read only ---- */

async function check() {
  const report = async (label: string, fn: () => Promise<string>) => {
    try {
      console.log(`${label}: ${await fn()}`);
    } catch (e) {
      console.log(`${label}: ERROR ${(e as Error).message}`);
    }
  };
  for (const url of rpcUrls()) {
    await report(`RPC ${url}`, async () => {
      const client = createPublicClient({ transport: http(url) });
      const [id, price, block] = await Promise.all([client.getChainId(), client.getGasPrice(), client.getBlockNumber()]);
      return `chain ${id}${id === ELYSIUM_CHAIN_ID ? " (expected)" : " (UNEXPECTED)"}, gas ${Number(price) / 1e9} gwei, block ${block}`;
    });
  }
  await report("drand", async () => {
    const res = await fetch(`https://api.drand.sh/${DRAND.chainHash}/info`);
    const info = (await res.json()) as { genesis_time: number; period: number };
    const ok = info.genesis_time === DRAND.genesisTime && info.period === DRAND.period;
    return `genesis ${info.genesis_time}, period ${info.period} ${ok ? "(matches the code)" : "(DIFFERS FROM THE CODE)"}`;
  });
  await report("drand round", async () => {
    const now = Date.now();
    const round = BigInt(Math.floor((now / 1000 - DRAND.genesisTime) / DRAND.period));
    return `round ${round}: ${await liveDrand.get(round, now)}`;
  });
  await report("Hyperliquid", async () => {
    const view = await hyperliquidMarket("HYPE")(Date.now());
    const last = view.market.candles.at(-1)!;
    return `${view.market.candles.length} closed hours, last ${new Date(last.t).toISOString()} close ${last.c}`;
  });
}

async function status() {
  const name = arg("name");
  if (!name) throw new Error("--name is required.");
  const manifest = JSON.parse(readFileSync(manifestPath(name), "utf8")) as Manifest;
  const client = createPublicClient({ transport: fallback(rpcUrls().map((u) => http(u))) }) as PublicClient;
  // The comparison arm is reported on its own: it never enters the main test.
  console.log(formatResults(await readResults(client, manifest.replicates.filter((r) => !r.wiring).map((r) => r.generation)), manifest.simulated));
  const arm = manifest.replicates.filter((r) => r.wiring);
  if (arm.length) console.log("\nShuffled wiring:\n" + formatResults(await readResults(client, arm.map((r) => r.generation)), manifest.simulated));
}

/** Anyone can run this: needs only the published manifest, an RPC, and public data. */
async function verify() {
  const path = arg("manifest") ?? (arg("name") ? manifestPath(arg("name")!) : null);
  if (!path) throw new Error("--manifest file or --name is required.");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  if (manifest.simulated) console.log("!! This record is a SIMULATION. Its results are not experiment results. !!");
  const client = createPublicClient({ transport: fallback(rpcUrls().map((u) => http(u))) }) as PublicClient;
  const prices = arg("prices");
  const source = prices ? replayMarket((JSON.parse(readFileSync(prices, "utf8")) as { candles: Parameters<typeof replayMarket>[0] }).candles, prices) : hyperliquidMarket(manifest.coin);
  const lab = makeLab(loadConnectome(join("data", "connectome")));
  const r = await verifyRun(client, manifest, lab, manifest.simulated ? simulatedDrand : liveDrand, source, Date.now(), (s) => console.log(s));
  console.log(`Checked: ${r.checked.thoughts} thoughts, ${r.checked.generations} generations, ${r.checked.genomes} genome hashes, ${r.checked.fossils} fossils, ${r.checked.holdouts} unseen periods, ${r.checked.drand} drand values, ${r.checked.evm} EVM recomputations`);
  if (r.problems.length) {
    console.log(`MISMATCH (${r.problems.length}):\n` + r.problems.map((p) => `  ${p}`).join("\n"));
    process.exitCode = 1;
  } else console.log("Result: the on-chain records were reproduced exactly from public inputs.");
}

async function healthCmd() {
  const name = arg("name");
  if (!name) throw new Error("--name is required.");
  const manifest = JSON.parse(readFileSync(manifestPath(name), "utf8")) as Manifest;
  const client = createPublicClient({ transport: fallback(rpcUrls().map((u) => http(u))) }) as PublicClient;
  const out = await health(client, manifest, Date.now(), join("runner", "state", name, "heartbeat"), process.env.MIN_BALANCE_HYPE ? Number(process.env.MIN_BALANCE_HYPE) : 0.05);
  writeFileSync(join("runner", "state", name, "status.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (out.problems.length) {
    process.exitCode = 1;
    if (process.env.ALERT_WEBHOOK_URL) await fetch(process.env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Notochord ${name}: ${out.problems.join("; ")}` }) });
  }
}

const commands: Record<string, () => Promise<unknown>> = { replay, check, deploy: deployLive, run: runLive, status, verify, health: healthCmd };

if (process.argv[1]?.endsWith("cli.ts")) {
  const command = process.argv[2] ?? "";
  if (!commands[command]) {
    console.error("Usage: replay | check | deploy --name X | run --name X | status --name X | verify --name X | health --name X");
    process.exit(1);
  }
  commands[command]().then(
    () => process.exit(0),
    (e) => {
      // The full message carries the URL and HTTP status; the short one hides what failed.
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
