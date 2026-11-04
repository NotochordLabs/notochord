// The Lab's command line.
//   rehearse  full Lab cycle on a throwaway local chain: real-size experiment fossils,
//             a test token, breeding, birth, a race on historical candles, verification
//   deploy    deploy LabHabitat on Elysium (needs LAB_OPERATOR_KEY and NOTOCHORD_LAB_LIVE)
//   run       the live operator loop
//   status    what the Lab holds, read-only
//   verify    rebuild every child and race from public inputs and compare with the chain
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  keccak256,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConnectome } from "../src/connectome";
import { deployReplicates, waitForReceipt } from "../runner/deploy";
import { chainHash, createPopulation, everyone, makeLab, PROTOCOL_RULES } from "../runner/engine";
import { DRAND, liveDrand, roundAt, simulatedDrand } from "../runner/sources";
import generationArtifact from "../runner/artifacts/Generation.json";
import fossilArtifact from "../runner/artifacts/Fossil.json";
import labArtifact from "./artifacts/LabHabitat.json";
import tokenArtifact from "./artifacts/TestChord.json";
import { HOUR, hyperliquidCandles, LabRunner, Status, type CandleSource, type LabCtx, type LabManifest } from "./runner";
import { verifyLab } from "./verify";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const ELYSIUM = 99901;
const LOCAL = 31337;
const DEFAULT_RPCS = ["https://rpc.betweenquotes.xyz"];
/** anvil's public test keys #0 and #1. Never hold real funds. */
const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
];
const DAY = 24 * HOUR;

function clients(urls: string[], chainId: number, key?: Hex) {
  const chain = defineChain({
    id: chainId,
    name: chainId === ELYSIUM ? "Elysium" : "Local",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: { default: { http: urls } },
  });
  const transport = fallback(urls.map((u) => http(u, { timeout: 90_000 })));
  const publicClient = createPublicClient({ chain, transport, pollingInterval: chainId === LOCAL ? 20 : 2000 }) as PublicClient;
  const wallet = key
    ? (createWalletClient({ chain, transport, account: privateKeyToAccount(key), pollingInterval: 2000 }) as WalletClient)
    : undefined;
  return { publicClient, wallet };
}

const labDir = (name: string) => join("lab", "state", name);
const manifestPath = (name: string) => join(labDir(name), "manifest.json");
const rpcUrls = () => (process.env.RPC_URLS ? process.env.RPC_URLS.split(",") : DEFAULT_RPCS);

async function deployContract(pc: PublicClient, w: WalletClient, artifact: { abi: unknown; bytecode: string }, args: unknown[]) {
  const tx = await w.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args, account: w.account!, chain: w.chain });
  const r = await waitForReceipt(pc, tx);
  if (r.status !== "success" || !r.contractAddress) throw new Error(`Deployment failed: ${tx}`);
  return r.contractAddress;
}

async function write(pc: PublicClient, w: WalletClient, address: Address, abi: unknown, functionName: string, args: unknown[]) {
  const tx = await w.writeContract({ address, abi: abi as Abi, functionName, args, account: w.account!, chain: w.chain });
  const r = await waitForReceipt(pc, tx);
  if (r.status !== "success") throw new Error(`${functionName} failed: ${tx}`);
  return r;
}

/** The Lab's rules, as published. Their hash goes on chain with the contract. */
export function rulesHash(): Hex {
  const files = ["lab/core.ts", "lab/runner.ts", "lab/verify.ts", "contracts/src/LabHabitat.sol", "lab/RULES.md"];
  return keccak256(toHex(files.map((f) => `${f}\n${readFileSync(f, "utf8").replace(/\r\n/g, "\n")}`).join("\n")));
}

/* ---------------------------------------------------------------- rehearsal */

async function rehearse() {
  const pricesPath = join("data", "prices-HYPE-1h.json");
  const { candles } = JSON.parse(readFileSync(pricesPath, "utf8")) as { candles: { t: number; c: number; v: number }[] };
  const lastMs = candles[candles.length - 1].t;
  const dayZeroMs = Math.floor((lastMs - 6 * DAY) / DAY) * DAY; // leaves room for two race days and warm-up
  const port = 8611;
  const url = `http://127.0.0.1:${port}`;
  const anvil = spawn(process.env.ANVIL_BIN ?? "anvil", ["--port", String(port), "--silent", "--timestamp", String(dayZeroMs / 1000 + 5 * 3600), "--code-size-limit", "100000"], { stdio: "ignore" });
  const failed = new Promise<never>((_, rej) => anvil.once("error", () => rej(new Error("anvil not found. Is Foundry installed?"))));
  const dir = labDir("rehearsal");
  rmSync(dir, { recursive: true, force: true });
  try {
    await Promise.race([waitForRpc(url), failed]);
    const op = clients([url], LOCAL, ANVIL_KEYS[0]);
    const holder = clients([url], LOCAL, ANVIL_KEYS[1]);
    const pc = op.publicClient;
    const chainNow = async () => Number((await pc.getBlock()).timestamp) * 1000;
    const travelTo = async (ms: number) => {
      await pc.request({ method: "evm_setNextBlockTimestamp" as never, params: [toHex(Math.floor(ms / 1000))] as never });
      await pc.request({ method: "evm_mine" as never, params: [] as never });
    };

    // An experiment replicate at real size, with its generation 0 stored as fossils.
    const connectome = loadConnectome(join("data", "connectome"));
    const exp = makeLab(connectome);
    const rules = { ...PROTOCOL_RULES, selectionSize: 8, controlSize: 2 };
    const [rep] = await deployReplicates(pc, op.wallet!, 1, rules, exp.layout.size, keccak256(toHex("rehearsal")));
    const round = roundAt((await chainNow()) + 60_000);
    await write(pc, op.wallet!, rep.generation, generationArtifact.abi, "commitGenesis", [round]);
    await travelTo((DRAND.genesisTime + (Number(round) - 1) * DRAND.period) * 1000 + 1000);
    const randomness = (await simulatedDrand.get(round, await chainNow()))!;
    const pop = createPopulation(exp, "rehearsal", randomness, rules);
    await write(pc, op.wallet!, rep.generation, generationArtifact.abi, "recordGenesis", [randomness, pop.selection.map(chainHash), pop.control.map(chainHash)]);
    const all = everyone(pop);
    for (let i = 0; i < all.length; i += 3) {
      const chunk = all.slice(i, i + 3);
      await write(pc, op.wallet!, rep.fossil, fossilArtifact.abi, "record", [0, chunk.map((s) => s.id), chunk.map((s) => toHex(s.genome))]);
    }
    console.log(`experiment replicate deployed, ${all.length} fossils stored`);

    // Token and Lab.
    const token = await deployContract(pc, op.wallet!, tokenArtifact, []);
    const cost = parseUnits("1000", 18);
    await write(pc, op.wallet!, token, tokenArtifact.abi, "mint", [holder.wallet!.account!.address, cost * 10n]);
    const startBlock = await pc.getBlockNumber();
    const lab = await deployContract(pc, op.wallet!, labArtifact, [
      token,
      op.wallet!.account!.address,
      cost,
      20,
      dayZeroMs / 1000,
      DRAND.genesisTime,
      DRAND.period,
      rulesHash(),
      [rep.fossil],
    ]);
    const manifest: LabManifest = {
      name: "rehearsal",
      chainId: LOCAL,
      lab,
      deployBlock: String(startBlock),
      token,
      operator: op.wallet!.account!.address,
      coin: "HYPE",
      dayZeroMs,
      breedCost: cost.toString(),
      maxPerDay: 20,
      rulesHash: rulesHash(),
      fossils: [rep.fossil],
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(manifestPath("rehearsal"), JSON.stringify(manifest, null, 2));

    const replayCandles: CandleSource = async (_coin, from, to) => candles.filter((k) => k.t >= from && k.t < to);
    const ctx: LabCtx = { publicClient: pc, wallet: op.wallet, manifest, connectome, drand: simulatedDrand, candles: replayCandles, now: () => 0, dir, log: (m) => console.log(`  ${m}`) };
    const runner = new LabRunner(ctx);
    const tick = async () => {
      ctx.now = () => nowCache;
      nowCache = await chainNow();
      return runner.step();
    };
    let nowCache = 0;

    // Day 0: a holder breeds three children from fossils. They race day 1.
    await write(pc, holder.wallet!, token, tokenArtifact.abi, "approve", [lab, cost * 10n]);
    const fossilParent = (id: number) => ({ kind: 0, source: 0, generation: 0, id });
    for (const [a, b] of [[1, 2], [3, 4], [2, 5]]) {
      await write(pc, holder.wallet!, lab, labArtifact.abi, "breed", [fossilParent(a), fossilParent(b)]);
    }
    console.log("bred 3 children on day 0");
    if ((await tick()) !== 0) throw new Error("nothing should be due before day 1");

    // Day 1 begins: their drand round is out, so they are born. One more is bred from two Lab brains.
    await travelTo(dayZeroMs + DAY + 2 * 60_000); // the draw is at 00:01
    await tick();
    await write(pc, holder.wallet!, lab, labArtifact.abi, "breed", [{ kind: 1, source: 0, generation: 0, id: 1 }, { kind: 1, source: 0, generation: 0, id: 2 }]);
    console.log("bred a grandchild from Lab brains 1 and 2");

    // Day 2 begins, day 1 has closed: the first three race, the grandchild is born.
    await travelTo(dayZeroMs + 2 * DAY + HOUR + 10 * 60_000);
    await tick();
    // Day 3: the grandchild races.
    await travelTo(dayZeroMs + 3 * DAY + HOUR + 10 * 60_000);
    await tick();

    const statuses = runner.all.map((b) => b.status);
    if (statuses.some((s) => s !== Status.Raced)) throw new Error(`not all raced: ${statuses}`);
    for (const b of runner.all) console.log(`  brain ${b.id}: day ${b.day}, fitness ${b.result!.fitness}, decisions ${b.result!.decisions}`);

    const burned = (await pc.readContract({ address: token, abi: tokenArtifact.abi as Abi, functionName: "balanceOf", args: ["0x000000000000000000000000000000000000dEaD"] })) as bigint;
    const held = (await pc.readContract({ address: token, abi: tokenArtifact.abi as Abi, functionName: "balanceOf", args: [lab] })) as bigint;
    console.log(`burned ${burned / 10n ** 18n} CHORD, Lab holds ${held}`);
    if (burned !== cost * 4n || held !== 0n) throw new Error("burn accounting is wrong");

    // Independent check from chain events and public inputs only, with no local state.
    const { wallet: _w, ...readOnly } = ctx;
    const report = await verifyLab({ ...readOnly, dir: join(dir, "verify") });
    console.log(report.ok ? `verified: ${report.checked} brains reproduced exactly` : `MISMATCH:\n${report.problems.join("\n")}`);
    if (!report.ok || report.checked !== 4) {
      process.exitCode = 1;
      return;
    }

    // A dishonest operator: brain 5 is recorded with a genome its parents and drand cannot produce.
    await write(pc, holder.wallet!, lab, labArtifact.abi, "breed", [fossilParent(6), fossilParent(7)]);
    await travelTo(dayZeroMs + 4 * DAY + 2 * 60_000);
    const r5 = (await simulatedDrand.get(BigInt((await pc.readContract({ address: lab, abi: labArtifact.abi as Abi, functionName: "brain", args: [5] }) as { drandRound: bigint }).drandRound), await chainNow()))!;
    await write(pc, op.wallet!, lab, labArtifact.abi, "recordBirths", [[5], [r5], [keccak256(toHex("not the real child"))]]);
    nowCache = await chainNow();
    const caught = await verifyLab({ ...readOnly, now: () => nowCache, dir: join(dir, "verify2") });
    const flagged = !caught.ok && caught.problems.some((p) => p === "brain 5: genome hash does not match");
    console.log(flagged ? `tamper test: caught (${caught.problems[0]})` : "tamper test: NOT CAUGHT");
    if (!flagged) process.exitCode = 1;
  } finally {
    anvil.kill();
  }
}

async function waitForRpc(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("anvil did not start.");
}

/* ---------------------------------------------------------------- live */

function liveKey(): Hex {
  const key = process.env.LAB_OPERATOR_KEY as Hex | undefined;
  if (!key) throw new Error("LAB_OPERATOR_KEY is not set.");
  if (process.env.NOTOCHORD_LAB_LIVE !== String(ELYSIUM)) throw new Error(`Writing to the real network needs NOTOCHORD_LAB_LIVE=${ELYSIUM}.`);
  if (key.toLowerCase() === (process.env.RUNNER_PRIVATE_KEY ?? "").toLowerCase()) {
    throw new Error("The Lab must not use the experiment's wallet.");
  }
  return key;
}

/** --manifest reads a published manifest, such as site/public/live/lab.json, so anyone can verify. */
const loadManifest = (name: string) => JSON.parse(readFileSync(arg("manifest") ?? manifestPath(name), "utf8")) as LabManifest;

async function deploy() {
  const name = arg("name") ?? "lab";
  if (existsSync(manifestPath(name))) throw new Error(`${name} is already deployed.`);
  const token = arg("token") as Address;
  const experiment = arg("experiment") ?? join("site", "public", "live", "d7f3a9c2.json");
  const cost = parseUnits(arg("cost") ?? "10000", 18);
  const cap = Number(arg("cap") ?? 200);
  if (!token) throw new Error("--token is required.");
  const exp = JSON.parse(readFileSync(experiment, "utf8")) as { replicates: { fossil: Address; wiring?: string }[] };
  const fossils = exp.replicates.filter((r) => !r.wiring).map((r) => r.fossil); // real wiring only
  const { publicClient, wallet } = clients(rpcUrls(), ELYSIUM, liveKey());
  const now = Date.now();
  const dayZeroMs = Math.floor(now / DAY) * DAY;
  const block = await publicClient.getBlockNumber();
  const lab = await deployContract(publicClient, wallet!, labArtifact, [token, wallet!.account!.address, cost, cap, dayZeroMs / 1000, DRAND.genesisTime, DRAND.period, rulesHash(), fossils]);
  const manifest: LabManifest = {
    name,
    chainId: ELYSIUM,
    lab,
    deployBlock: String(block),
    token,
    operator: wallet!.account!.address,
    coin: "HYPE",
    dayZeroMs,
    breedCost: cost.toString(),
    maxPerDay: cap,
    rulesHash: rulesHash(),
    fossils,
  };
  mkdirSync(labDir(name), { recursive: true });
  writeFileSync(manifestPath(name), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

async function run() {
  const name = arg("name") ?? "lab";
  const manifest = loadManifest(name);
  const { publicClient, wallet } = clients(rpcUrls(), manifest.chainId, liveKey());
  const runner = new LabRunner({
    publicClient,
    wallet,
    manifest,
    connectome: loadConnectome(join("data", "connectome")),
    drand: liveDrand,
    candles: hyperliquidCandles,
    now: () => Date.now(),
    dir: labDir(name),
    log: (m) => console.log(`${new Date().toISOString()} ${m}`),
  });
  // --once: one pass and exit, for a timer that starts it every few minutes and frees its memory between runs.
  const once = process.argv.includes("--once");
  for (;;) {
    try {
      const moved = await runner.step();
      if (once) console.log(`${new Date().toISOString()} pass done, ${moved} brain(s) moved, ${runner.all.length} known`);
    } catch (e) {
      console.error(`${new Date().toISOString()} ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
      if (once) process.exitCode = 1;
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

async function status() {
  const name = arg("name") ?? "lab";
  const manifest = loadManifest(name);
  const { publicClient } = clients(rpcUrls(), manifest.chainId);
  const s = (await publicClient.readContract({ address: manifest.lab, abi: labArtifact.abi as Abi, functionName: "state" })) as readonly unknown[];
  console.log({ token: s[0], cost: String(s[2]), burned: String(s[3]), brains: s[4], today: s[5], bredForTomorrow: s[6], cap: s[7], closed: s[8] });
}

async function verify() {
  const name = arg("name") ?? "lab";
  const manifest = loadManifest(name);
  const { publicClient } = clients(rpcUrls(), manifest.chainId);
  const report = await verifyLab({
    publicClient,
    manifest,
    connectome: loadConnectome(join("data", "connectome")),
    drand: liveDrand,
    candles: hyperliquidCandles,
    now: () => Date.now(),
    dir: join(labDir(name), "verify"),
    log: () => {},
  });
  console.log(report.ok ? `Verified: ${report.checked} brains reproduced exactly.` : `MISMATCH (${report.problems.length}):\n${report.problems.join("\n")}`);
  if (!report.ok) process.exitCode = 1;
}

const commands: Record<string, () => Promise<void>> = { rehearse, deploy, run, status, verify };
const cmd = commands[process.argv[2]];
if (!cmd) {
  console.error("Usage: rehearse | deploy --token 0x.. [--cost 10000] [--cap 200] | run [--once] | status | verify  [--name lab] [--manifest path]");
  process.exit(1);
}
cmd().catch((e) => {
  console.error(`Error: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
  process.exit(1);
});
