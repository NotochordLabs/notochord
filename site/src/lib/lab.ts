/**
 * The Lab, read from the chain in this browser, and the two transactions a holder
 * sends: approve and breed. Nothing here is filled in from a simulation; a failed
 * read leaves a field empty.
 */

export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const DAY = 86_400_000;
const DRAND = { chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971", genesis: 1692803367, period: 3 };
export const drandUrl = (round: number) => `https://api.drand.sh/${DRAND.chainHash}/public/${round}`;
/** First drand quicknet round published at or after `ms`, as the contract computes it. */
export const drandRoundAt = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return t <= DRAND.genesis ? 1 : Math.floor((t - DRAND.genesis + DRAND.period - 1) / DRAND.period) + 1;
};

const SEL = {
  state: "0xc19d93fb",
  brain: "0x8bb35b70",
  breed: "0xd6aba94e",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  record: "0x2c16cd8a",
  genomeOf: "0xa6647b78",
};
const TOPIC = {
  bred: "0x26f705ecf7fb32dadccc6b715af602058f09d55c486941fc26d2ccb19a83b71f",
  born: "0x34218cebfc558f9ad822ec0d81ac6eae7b08be1500f043d94a0eef66b6f221b2",
  raced: "0xeabb5fcf2c86c3c575e14ed1bbaf302ab30ac1978cfc198b0c17f6765ba89761",
  fossilized: "0xc210b3a9b76c8a768b627ebd3da9a97bac45f612d72d6915410c528c9317a662",
};
const ERRORS: Record<string, string> = {
  "0xd202ca72": "Tomorrow's places are all taken. Breeding opens again after 00:00 UTC.",
  "0x0978c304": "A brain cannot be bred with itself. Pick two different parents.",
  "0xaf9741ae": "The Lab is closed to new breeding.",
  "0xc6ec4ffa": "That Lab brain has not been born yet.",
  "0x8d25ccb9": "That fossil is not stored on chain yet.",
  "0x1fee38b2": "Control brains cannot be parents. Pick a filled disc.",
  "0xe77a1bad": "No $CHORD reached the dead address.",
};

/* ---------------------------------------------------------------- config */

export interface ExperimentManifest {
  chainId: number;
  deployBlock: string;
  replicates: { index: number; fossil: string; specimen: string; wiring?: string }[];
}
export interface LabConfig {
  rpc: string;
  chainId: number;
  chainName: string;
  /** Real-wiring replicates, in the order the Lab contract lists their fossils. */
  sources: { replicate: number; fossil: string; specimen: string }[];
  experimentBlock: number;
  /** Absent until the Lab contract is deployed. */
  lab: null | { address: string; deployBlock: number; token: string; breedCost: bigint; maxPerDay: number; dayZeroMs: number };
}

export async function loadConfig(): Promise<LabConfig> {
  const [c, m, l] = await Promise.all([
    fetch("/live/config.json").then((r) => r.json() as Promise<{ rpc: string; chainId: number; chainName?: string }>),
    fetch("/live/d7f3a9c2.json").then((r) => r.json() as Promise<ExperimentManifest>),
    fetch("/live/lab.json").then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<null | { lab?: string; deployBlock?: string; token?: string; breedCost?: string; maxPerDay?: number; dayZeroMs?: number }>,
  ]);
  const sources = m.replicates.filter((r) => !r.wiring).map((r) => ({ replicate: r.index, fossil: r.fossil, specimen: r.specimen }));
  const lab = l?.lab && l.token && l.breedCost && l.maxPerDay && l.dayZeroMs !== undefined
    ? { address: l.lab, deployBlock: Number(l.deployBlock ?? 0), token: l.token, breedCost: BigInt(l.breedCost), maxPerDay: l.maxPerDay, dayZeroMs: l.dayZeroMs }
    : null;
  // The wallet network comes from the site config, so a local test chain can never be mistaken for Elysium.
  return { rpc: c.rpc, chainId: c.chainId, chainName: c.chainName ?? "Elysium", sources, experimentBlock: Number(m.deployBlock), lab };
}

/* ---------------------------------------------------------------- rpc */

interface Log { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string }

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? "no result");
  return j.result;
}
/** Elysium's RPC answers at most 50 calls per batch and silently drops the rest. */
const BATCH = 40;
async function batch(url: string, calls: { to: string; data: string }[]): Promise<(string | null)[]> {
  const out: (string | null)[] = calls.map(() => null);
  for (let start = 0; start < calls.length; start += BATCH) {
    const body = calls.slice(start, start + BATCH).map((c, i) => ({ jsonrpc: "2.0", id: start + i, method: "eth_call", params: [c, "latest"] }));
    const res = (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as { id: number; result?: string }[];
    if (Array.isArray(res)) for (const r of res) if (typeof r.id === "number") out[r.id] = r.result ?? null;
  }
  return out;
}
const call = (url: string, to: string, data: string) => rpc<string>(url, "eth_call", [{ to, data }, "latest"]);
const logs = (url: string, address: string, fromBlock: number, topics: (string | null)[]) =>
  rpc<Log[]>(url, "eth_getLogs", [{ address, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: "latest", topics }]);

export const word = (n: number | bigint | string) =>
  (typeof n === "string" ? n.replace(/^0x/, "").toLowerCase() : BigInt(n).toString(16)).padStart(64, "0");
const words = (data: string) => (data.replace(/^0x/, "").match(/.{64}/g) ?? []);
const u = (w?: string) => BigInt(`0x${w || "0"}`);
const i32 = (w?: string) => Number(BigInt.asIntN(32, u(w)));
const hexBytes = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/../g) ?? [], (b) => parseInt(b, 16));

/* ---------------------------------------------------------------- fossils */

export interface Fossil {
  source: number;
  replicate: number;
  generation: number;
  id: number;
  genomeHash: string;
  /** From the Specimen record. */
  born?: number;
  parentA?: number;
  parentB?: number;
  control?: boolean;
}

/** Every fossil stored so far for one real-wiring replicate, grouped by generation. */
export async function fossilsOf(cfg: LabConfig, source: number): Promise<Map<number, Fossil[]>> {
  const s = cfg.sources[source];
  const found = await logs(cfg.rpc, s.fossil, cfg.experimentBlock, [TOPIC.fossilized]);
  const list: Fossil[] = found.map((l) => ({
    source,
    replicate: s.replicate,
    generation: Number(u(l.topics[1].slice(2))),
    id: Number(u(l.topics[2].slice(2))),
    genomeHash: `0x${words(l.data)[0]}`,
  }));
  const ids = [...new Set(list.map((f) => f.id))];
  const records = await batch(cfg.rpc, ids.map((id) => ({ to: s.specimen, data: `${SEL.record}${word(id)}` })));
  const byId = new Map<number, string[]>();
  ids.forEach((id, i) => records[i] && byId.set(id, words(records[i]!)));
  const out = new Map<number, Fossil[]>();
  for (const f of list) {
    const r = byId.get(f.id);
    if (r) Object.assign(f, { parentA: Number(u(r[1])), parentB: Number(u(r[2])), born: Number(u(r[3])), control: u(r[5]) === 1n });
    if (!out.has(f.generation)) out.set(f.generation, []);
    out.get(f.generation)!.push(f);
  }
  for (const v of out.values()) v.sort((a, b) => Number(a.control) - Number(b.control) || a.id - b.id);
  return new Map([...out.entries()].sort((a, b) => b[0] - a[0]));
}

const genomeCache = new Map<string, Promise<Uint8Array>>();
/** A fossil's genome, read from its on-chain blob and checked against the recorded hash. */
export function fossilGenome(cfg: LabConfig, f: Fossil): Promise<Uint8Array> {
  const key = `${f.source}:${f.generation}:${f.id}`;
  if (!genomeCache.has(key)) {
    genomeCache.set(key, (async () => {
      const r = words(await call(cfg.rpc, cfg.sources[f.source].fossil, `${SEL.genomeOf}${word(f.generation)}${word(f.id)}`));
      const size = Number(u(r[1]));
      const bytes = hexBytes(r.slice(2).join("")).slice(0, size);
      const hash = `0x${[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      if (hash !== f.genomeHash.toLowerCase()) throw new Error("genome does not match its hash");
      return bytes;
    })());
    genomeCache.get(key)!.catch(() => genomeCache.delete(key));
  }
  return genomeCache.get(key)!;
}

/* ---------------------------------------------------------------- lab */

export type Status = "bred" | "born" | "raced";
export interface ParentRef { kind: "fossil" | "lab"; source: number; generation: number; id: number }
export interface LabBrain {
  id: number;
  breeder: string;
  day: number;
  drandRound: number;
  parents: [ParentRef, ParentRef];
  parentHashes: [string, string];
  burned: bigint;
  tx: string;
  status: Status;
  randomness?: string;
  genomeHash?: string;
  result?: { pnl: number; maxDrawdown: number; fitness: number; decisionsHash: string };
}
export interface LabState {
  burned: bigint;
  brains: number;
  today: number;
  tomorrowCount: number;
  cap: number;
  closed: boolean;
  cost: bigint;
  list: LabBrain[];
}

const parentAt = (w: string[], i: number): ParentRef => ({
  kind: u(w[i]) === 1n ? "lab" : "fossil",
  source: Number(u(w[i + 1])),
  generation: Number(u(w[i + 2])),
  id: Number(u(w[i + 3])),
});

export async function readLab(cfg: LabConfig): Promise<LabState> {
  const lab = cfg.lab!;
  const [s, bred, born, raced] = await Promise.all([
    call(cfg.rpc, lab.address, SEL.state),
    logs(cfg.rpc, lab.address, lab.deployBlock, [TOPIC.bred]),
    logs(cfg.rpc, lab.address, lab.deployBlock, [TOPIC.born]),
    logs(cfg.rpc, lab.address, lab.deployBlock, [TOPIC.raced]),
  ]);
  const w = words(s);
  const byId = new Map<number, LabBrain>();
  for (const l of bred) {
    const d = words(l.data);
    const id = Number(u(l.topics[1].slice(2)));
    byId.set(id, {
      id,
      breeder: `0x${l.topics[2].slice(26)}`,
      day: Number(u(l.topics[3].slice(2))),
      drandRound: Number(u(d[0])),
      parents: [parentAt(d, 1), parentAt(d, 5)],
      parentHashes: [`0x${d[9]}`, `0x${d[10]}`],
      burned: u(d[11]),
      tx: l.transactionHash,
      status: "bred",
    });
  }
  for (const l of born) {
    const b = byId.get(Number(u(l.topics[1].slice(2))));
    const d = words(l.data);
    if (b) Object.assign(b, { status: "born", randomness: `0x${d[0]}`, genomeHash: `0x${d[1]}` });
  }
  for (const l of raced) {
    const b = byId.get(Number(u(l.topics[1].slice(2))));
    const d = words(l.data);
    if (b) Object.assign(b, { status: "raced", result: { pnl: i32(d[0]), maxDrawdown: i32(d[1]), fitness: i32(d[2]), decisionsHash: `0x${d[3]}` } });
  }
  return {
    cost: u(w[2]),
    burned: u(w[3]),
    brains: Number(u(w[4])),
    today: Number(u(w[5])),
    tomorrowCount: Number(u(w[6])),
    cap: Number(u(w[7])),
    closed: u(w[8]) === 1n,
    list: [...byId.values()].sort((a, b) => b.id - a.id),
  };
}

/* ---------------------------------------------------------------- wallet */

export interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(e: string, f: (...a: unknown[]) => void): void;
  removeListener?(e: string, f: (...a: unknown[]) => void): void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
}
export interface Wallet { id: string; name: string; icon: string | null; provider: Eip1193 }

const legacy = () => (typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eip1193 }).ethereum);
/** True when some wallet is present, announced or injected. */
export const hasInjected = () => !!legacy();

/**
 * Every wallet in this browser. EIP-6963 lets each extension announce itself, so
 * Rabby, MetaMask, Coinbase, OKX, Rainbow and the rest can sit side by side without
 * fighting over window.ethereum. Wallets that predate it are picked up from
 * window.ethereum when nothing else announced.
 */
export function discoverWallets(onChange: (w: Wallet[]) => void): () => void {
  const found = new Map<string, Wallet>();
  const emit = () => onChange([...found.values()]);
  const announce = (e: Event) => {
    const d = (e as CustomEvent<{ info?: { uuid?: string; rdns?: string; name?: string; icon?: string }; provider?: Eip1193 }>).detail;
    if (!d?.provider || !d.info?.name) return;
    const id = d.info.rdns || d.info.uuid || d.info.name;
    const icon = typeof d.info.icon === "string" && /^data:image\/(png|svg\+xml|webp|jpeg|gif);/.test(d.info.icon) ? d.info.icon : null;
    found.delete("injected");
    found.set(id, { id, name: d.info.name.slice(0, 40), icon, provider: d.provider });
    emit();
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const late = setTimeout(() => {
    const eth = legacy();
    if (eth && found.size === 0) {
      const name = eth.isRabby ? "Rabby" : eth.isCoinbaseWallet ? "Coinbase Wallet" : eth.isMetaMask ? "MetaMask" : "Browser wallet";
      found.set("injected", { id: "injected", name, icon: null, provider: eth });
    }
    emit();
  }, 500);
  return () => { window.removeEventListener("eip6963:announceProvider", announce); clearTimeout(late); };
}

/** The code of a wallet error, wherever the wallet put it. */
export const errorCode = (e: unknown): number | undefined => {
  const x = e as { code?: number; data?: { originalError?: { code?: number } }; cause?: { code?: number } };
  return x?.data?.originalError?.code ?? x?.cause?.code ?? x?.code;
};

/** Puts the wallet on Elysium, adding the network first if the wallet does not know it. */
export async function ensureChain(cfg: LabConfig, eth: Eip1193): Promise<void> {
  const want = `0x${cfg.chainId.toString(16)}`;
  const on = async () => Number(await eth.request({ method: "eth_chainId" })) === cfg.chainId;
  if (await on()) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e) {
    const code = errorCode(e);
    if (code === 4001) throw e;
    // 4902 is the standard "unknown chain"; some wallets send -32603 or a bare message instead.
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: want, chainName: cfg.chainName, nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: [cfg.rpc] }],
    });
    if (!(await on())) await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  }
  if (!(await on())) throw new Error(`Your wallet is not on ${cfg.chainName}. Switch network in the wallet and try again.`);
}

export async function connect(cfg: LabConfig, eth: Eip1193): Promise<string> {
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("The wallet shared no account.");
  await ensureChain(cfg, eth);
  return accounts[0];
}

export async function holdings(cfg: LabConfig, account: string) {
  const lab = cfg.lab!;
  const [balance, allowance] = await Promise.all([
    call(cfg.rpc, lab.token, `${SEL.balanceOf}${word(account)}`),
    call(cfg.rpc, lab.token, `${SEL.allowance}${word(account)}${word(lab.address)}`),
  ]);
  return { balance: BigInt(balance), allowance: BigInt(allowance) };
}

const encodeParent = (p: ParentRef) => word(p.kind === "lab" ? 1 : 0) + word(p.source) + word(p.generation) + word(p.id);
export const breedData = (a: ParentRef, b: ParentRef) => `${SEL.breed}${encodeParent(a)}${encodeParent(b)}`;
export const approveData = (spender: string, amount: bigint) => `${SEL.approve}${word(spender)}${word(amount)}`;

/** A readable reason from a revert, or null when the call would succeed. */
export async function simulate(cfg: LabConfig, from: string, to: string, data: string): Promise<string | null> {
  try {
    await rpc(cfg.rpc, "eth_call", [{ from, to, data }, "latest"]);
    return null;
  } catch (e) {
    return explain(e);
  }
}

export function explain(e: unknown): string {
  const any = e as { code?: number; message?: string; data?: unknown };
  const code = errorCode(e);
  if (code === 4001 || /user (rejected|denied)|rejected by user/i.test(any?.message ?? "")) return "You declined in your wallet.";
  if (code === -32002) return "Your wallet already has a request open. Check the wallet window.";
  const text = `${any?.message ?? ""} ${typeof any?.data === "string" ? any.data : JSON.stringify(any?.data ?? "")}`;
  const hit = Object.keys(ERRORS).find((k) => text.includes(k.slice(2)));
  if (hit) return ERRORS[hit];
  if (/insufficient|exceeds balance/i.test(text)) return "Not enough $CHORD in this wallet.";
  if (/allowance/i.test(text)) return "The Lab needs your approval first.";
  return any?.message?.split("\n")[0] ?? "The transaction failed.";
}

/** Sends from the chosen wallet, after checking it is still on Elysium and on the same account. */
export async function send(cfg: LabConfig, eth: Eip1193, from: string, to: string, data: string): Promise<string> {
  await ensureChain(cfg, eth);
  const now = ((await eth.request({ method: "eth_accounts" })) as string[]) ?? [];
  if (!now.some((a) => a.toLowerCase() === from.toLowerCase())) throw new Error("The wallet changed account. Connect again.");
  return (await eth.request({ method: "eth_sendTransaction", params: [{ from, to, data, value: "0x0" }] })) as string;
}

export async function receipt(cfg: LabConfig, tx: string): Promise<{ ok: boolean; logs: Log[] }> {
  for (let i = 0; i < 120; i++) {
    const r = await rpc<{ status: string; logs: Log[] } | null>(cfg.rpc, "eth_getTransactionReceipt", [tx]).catch(() => null);
    if (r) return { ok: r.status === "0x1", logs: r.logs };
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("The transaction is taking long. Check it in your wallet.");
}
export const bredIdIn = (l: Log[]) => {
  const x = l.find((e) => e.topics[0] === TOPIC.bred);
  return x ? Number(u(x.topics[1].slice(2))) : null;
};

/* ---------------------------------------------------------------- format */

export const short = (x: string) => `${x.slice(0, 6)}…${x.slice(-4)}`;
export function chord(amount: bigint) {
  const whole = amount / 10n ** 18n;
  return whole.toLocaleString("en-US");
}
export const dayStart = (cfg: LabConfig, day: number) => cfg.lab!.dayZeroMs + day * DAY;
export const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
