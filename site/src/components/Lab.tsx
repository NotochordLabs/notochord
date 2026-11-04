"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approveData, breedData, bredIdIn, chord, connect, DAY, DEAD, dayStart, drandRoundAt, drandUrl, explain, fossilGenome, fossilsOf,
  discoverWallets, ensureChain, holdings, loadConfig, readLab, receipt, send, short, simulate, utc,
  type Fossil, type LabBrain, type LabConfig, type LabState, type ParentRef, type Wallet,
} from "@/lib/lab";

const COLS = 86;
const PLANNED = { cost: "10,000", cap: 200 };
const REMEMBER = "notochord-lab-wallet";
const fmtBps = (x: number) => `${x > 0 ? "+" : ""}${(x / 100).toFixed(2)}%`;

/* ---------------------------------------------------------------- picks */

type Pick =
  | { kind: "fossil"; fossil: Fossil }
  | { kind: "lab"; brain: LabBrain };

const pickRef = (p: Pick): ParentRef =>
  p.kind === "fossil" ? { kind: "fossil", source: p.fossil.source, generation: p.fossil.generation, id: p.fossil.id } : { kind: "lab", source: 0, generation: 0, id: p.brain.id };
const pickKey = (p: Pick | null) => (!p ? "" : p.kind === "fossil" ? `f${p.fossil.source}:${p.fossil.generation}:${p.fossil.id}` : `l${p.brain.id}`);
const pickName = (p: Pick) => (p.kind === "fossil" ? `Specimen ${p.fossil.id}` : `Lab brain ${p.brain.id}`);
const refName = (r: ParentRef, cfg: LabConfig | null) =>
  r.kind === "lab" ? `Lab ${r.id}` : `Pop ${cfg?.sources[r.source]?.replicate ?? r.source + 1} · gen ${r.generation} · #${r.id}`;
/** Same rule as the contract: a fossil is the same parent across generations. */
const sameParent = (a: Pick, b: Pick) =>
  a.kind === b.kind && (a.kind === "lab" ? a.brain.id === (b as typeof a).brain.id : a.fossil.source === (b as typeof a).fossil.source && a.fossil.id === (b as typeof a).fossil.id);

function wellColor(hash: string) {
  const n = parseInt(hash.slice(2, 8), 16);
  return `hsl(${188 + (n % 44)}, ${62 + ((n >> 8) % 24)}%, ${50 + ((n >> 16) % 22)}%)`;
}

/* ---------------------------------------------------------------- clock */

function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
const span = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};

/* ---------------------------------------------------------------- genome canvases */

function GenomeCanvas({ genome, label }: { genome: Uint8Array | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !genome) return;
    const rows = Math.ceil(genome.length / COLS);
    c.width = COLS * 3;
    c.height = rows * 3;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    genome.forEach((v, i) => {
      g.fillStyle = `rgb(${24 + v * 0.55},${36 + v * 0.8},${70 + v * 0.72})`;
      g.fillRect((i % COLS) * 3, Math.floor(i / COLS) * 3, 2, 2);
    });
  }, [genome]);
  return <canvas ref={ref} className={`labGenome ${genome ? "" : "empty"}`} role="img" aria-label={label} />;
}

/** Where the parents agree the child is set; where they differ, drand picks each gene. */
function ChildCanvas({ a, b }: { a: Uint8Array | null; b: Uint8Array | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = a?.length ?? b?.length ?? COLS * 40;
    const rows = Math.ceil(size / COLS);
    c.width = COLS * 3;
    c.height = rows * 3;
    const g = c.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, frame = 0, stopped = false;
    const draw = () => {
      if (stopped) return;
      g.fillStyle = "#060913";
      g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < size; i++) {
        const x = (i % COLS) * 3, y = Math.floor(i / COLS) * 3;
        if (!a || !b) {
          g.fillStyle = ((i * 7 + frame) % 23) < 2 ? "#1b2340" : "#10162b";
        } else if (a[i] === b[i]) {
          g.fillStyle = "#2a3350";
        } else {
          const side = still ? i % 2 : (Math.sin(i * 12.9898 + frame * 0.07 + (i % 13)) > 0 ? 1 : 0);
          g.fillStyle = side ? "#41d3e6" : "#6e8bff";
        }
        g.fillRect(x, y, 2, 2);
      }
      frame++;
      if (!still) raf = window.setTimeout(() => requestAnimationFrame(draw), 120) as unknown as number;
    };
    draw();
    return () => { stopped = true; clearTimeout(raf); };
  }, [a, b]);
  return <canvas ref={ref} className="labGenome childGenome" role="img" aria-label="The child's genome before birth: shared genes are fixed, differing genes are still open." />;
}

/* ---------------------------------------------------------------- family tree */

function FamilyTree({ brain, all, cfg }: { brain: LabBrain; all: LabBrain[]; cfg: LabConfig | null }) {
  type Node = { label: string; sub: string; lab: boolean; x: number; y: number; parent?: number };
  const nodes: Node[] = [];
  const levelH = 70;
  const walk = (label: string, sub: string, lab: boolean, refs: ParentRef[] | null, depth: number, x0: number, x1: number, parent?: number) => {
    const me = nodes.push({ label, sub: sub === "born" ? "racing" : sub === "bred" ? "waiting" : sub, lab, x: (x0 + x1) / 2, y: 26 + depth * levelH, parent }) - 1;
    if (!refs || depth >= 3) return;
    const mid = (x0 + x1) / 2;
    refs.forEach((r, i) => {
      const [a, b] = i === 0 ? [x0, mid] : [mid, x1];
      const child = r.kind === "lab" ? all.find((z) => z.id === r.id) : undefined;
      walk(r.kind === "lab" ? `Lab ${r.id}` : `#${r.id}`, r.kind === "lab" ? (child ? `day ${child.day}` : "") : `Pop ${cfg?.sources[r.source]?.replicate ?? "?"} · gen ${r.generation}`, r.kind === "lab", child ? child.parents : null, depth + 1, a, b, me);
    });
  };
  walk(`Lab ${brain.id}`, brain.result ? `fitness ${fmtBps(brain.result.fitness)}` : brain.status, true, brain.parents, 0, 0, 1);
  const depth = Math.max(...nodes.map((n) => n.y));
  // Width from the deepest level, so a shallow tree is drawn large and a deep one still fits.
  const W = Math.max(400, 2 ** Math.round((depth - 26) / levelH) * 104);
  nodes.forEach((n) => { n.x *= W; });
  return (
    <svg className="labTree" viewBox={`0 0 ${W} ${depth + 34}`} role="img" aria-label={`Family tree of Lab brain ${brain.id}`}>
      {nodes.map((n, i) => n.parent !== undefined && (
        <path key={`e${i}`} d={`M${nodes[n.parent].x} ${nodes[n.parent].y + 31} C ${nodes[n.parent].x} ${n.y - 22}, ${n.x} ${nodes[n.parent].y + 44}, ${n.x} ${n.y - 13}`} className="treeEdge" />
      ))}
      {nodes.map((n, i) => (
        <g key={i} transform={`translate(${n.x} ${n.y})`}>
          <rect x={-44} y={-13} width={88} height={26} rx={n.lab ? 13 : 4} className={n.lab ? "treeLab" : "treeFossil"} />
          <text y={1} className="treeLabel">{n.label}</text>
          <text y={26} className="treeSub">{n.sub}</text>
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- page */

type Flow =
  | { step: "idle" }
  | { step: "busy"; what: string }
  | { step: "done"; id: number | null; tx: string }
  | { step: "error"; message: string };

/** Brains bred per Lab day, read from the contract's own events. */
function BredPerDay({ list, cfg }: { list: LabBrain[]; cfg: LabConfig }) {
  const days = new Map<number, number>();
  for (const b of list) days.set(b.day, (days.get(b.day) ?? 0) + 1);
  const rows = [...days.entries()].sort((a, b) => a[0] - b[0]).slice(-30);
  const top = Math.max(...rows.map(([, n]) => n));
  return (
    <figure className="bredChart">
      <figcaption>Brains bred per day</figcaption>
      <div role="img" aria-label={rows.map(([d, n]) => `${utc(dayStart(cfg, d)).slice(0, 10)}: ${n}`).join(", ")}>
        {rows.map(([d, n]) => (
          <span key={d} title={`${utc(dayStart(cfg, d)).slice(0, 10)}: ${n}`}><b>{n}</b><i style={{ height: `${(n / top) * 100}%` }} /></span>
        ))}
      </div>
    </figure>
  );
}

export default function Lab() {
  const now = useNow();
  const [cfg, setCfg] = useState<LabConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [lab, setLab] = useState<LabState | null>(null);
  const [source, setSource] = useState<number | "lab">(0);
  const [fossils, setFossils] = useState<Map<number, Map<number, Fossil[]>>>(new Map());
  const [generation, setGeneration] = useState<number | null>(null);
  const [picks, setPicks] = useState<[Pick | null, Pick | null]>([null, null]);
  const [genomes, setGenomes] = useState<[Uint8Array | null, Uint8Array | null]>([null, null]);
  const [account, setAccount] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [chainOk, setChainOk] = useState(true);
  const [chooser, setChooser] = useState(false);
  const [held, setHeld] = useState<{ balance: bigint; allowance: bigint } | null>(null);
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [filter, setFilter] = useState<"all" | "mine" | "bred" | "born" | "raced">("all");
  const [order, setOrder] = useState<"new" | "best">("new");
  const [open, setOpen] = useState<number | null>(null);

  /* config, then the Lab every minute */
  useEffect(() => {
    loadConfig().then(setCfg).catch(() => setFailed(true));
  }, []);
  const refreshLab = useCallback(async () => {
    if (!cfg?.lab) return;
    try { setLab(await readLab(cfg)); setFailed(false); } catch { setFailed(true); }
  }, [cfg]);
  useEffect(() => {
    void refreshLab();
    const t = setInterval(refreshLab, 60_000);
    return () => clearInterval(t);
  }, [refreshLab]);

  /* fossils for the replicate on screen */
  useEffect(() => {
    if (!cfg || source === "lab" || fossils.has(source)) return;
    fossilsOf(cfg, source).then((m) => setFossils((old) => new Map(old).set(source, m))).catch(() => setFailed(true));
  }, [cfg, source, fossils]);
  const gens = source === "lab" ? null : fossils.get(source);
  useEffect(() => {
    if (gens && (generation === null || !gens.has(generation))) setGeneration(gens.keys().next().value ?? null);
  }, [gens, generation]);

  /* genomes of the picked fossils, checked against their hashes */
  useEffect(() => {
    if (!cfg) return;
    picks.forEach((p, i) => {
      if (!p || p.kind !== "fossil") { setGenomes((g) => (i ? [g[0], null] : [null, g[1]])); return; }
      fossilGenome(cfg, p.fossil).then((bytes) => setGenomes((g) => (i ? [g[0], bytes] : [bytes, g[1]]))).catch(() => setGenomes((g) => (i ? [g[0], null] : [null, g[1]])));
    });
  }, [cfg, picks]);

  /* wallet */
  /** The account the page is showing; a balance that arrives for any other account is dropped. */
  const shown = useRef<string | null>(null);
  useEffect(() => { shown.current = account?.toLowerCase() ?? null; }, [account]);
  const loadHeld = useCallback(async (a: string) => {
    if (!cfg?.lab) return;
    shown.current = a.toLowerCase();
    const h = await holdings(cfg, a).catch(() => null);
    if (shown.current === a.toLowerCase()) setHeld(h);
  }, [cfg]);
  useEffect(() => discoverWallets(setWallets), []);
  /* a wallet used here before reconnects without a prompt, if it still shares an account */
  const resumed = useRef(false);
  useEffect(() => {
    if (!cfg || !wallets || wallet || resumed.current) return;
    resumed.current = true;
    let id: string | null = null;
    try { id = localStorage.getItem(REMEMBER); } catch { /* storage blocked */ }
    const w = wallets.find((x) => x.id === id);
    if (!w) return;
    w.provider.request({ method: "eth_accounts" }).then(async (acc) => {
      const a = (acc as string[])?.[0];
      if (!a) return;
      setWallet(w);
      setAccount(a);
      setChainOk(Number(await w.provider.request({ method: "eth_chainId" })) === cfg.chainId);
      void loadHeld(a);
    }).catch(() => {});
  }, [cfg, wallets, wallet, loadHeld]);
  /* follow the wallet: another account, another network, or disconnected */
  useEffect(() => {
    const eth = wallet?.provider;
    if (!eth?.on || !cfg) return;
    const accounts = (...x: unknown[]) => {
      const a = (x[0] as string[])?.[0] ?? null;
      setAccount(a);
      setHeld(null);
      setFlow({ step: "idle" });
      if (a) void loadHeld(a); else setWallet(null);
    };
    const chain = (...x: unknown[]) => setChainOk(Number(x[0]) === cfg.chainId);
    eth.on("accountsChanged", accounts);
    eth.on("chainChanged", chain);
    return () => { eth.removeListener?.("accountsChanged", accounts); eth.removeListener?.("chainChanged", chain); };
  }, [wallet, cfg, loadHeld]);

  const choose = (p: Pick) => {
    setFlow({ step: "idle" });
    setPicks(([a, b]) => {
      if (pickKey(a) === pickKey(p)) return [null, b];
      if (pickKey(b) === pickKey(p)) return [a, null];
      if (!a) return [p, b];
      if (!b) return [a, p];
      return [a, p];
    });
  };

  const agreement = useMemo(() => {
    const [a, b] = genomes;
    if (!a || !b || a.length !== b.length) return null;
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    return { same, differ: a.length - same, size: a.length };
  }, [genomes]);

  /* the cycle, from the clock */
  const tomorrow = now === null ? null : Math.floor(now / DAY) * DAY + DAY;
  /** The contract draws one minute after midnight, so no breeding can follow the draw. */
  const birth = tomorrow === null ? null : tomorrow + 60_000;
  const round = birth === null ? null : drandRoundAt(birth);

  const cost = lab?.cost ?? cfg?.lab?.breedCost ?? null;
  const ready = !!cfg?.lab && !!lab && !lab.closed;
  const [pa, pb] = picks;
  const problem = !pa || !pb ? "Pick two parents." : sameParent(pa, pb) ? "A brain cannot be bred with itself." : null;

  async function doConnect(w: Wallet) {
    if (!cfg) return;
    setChooser(false);
    setFlow({ step: "busy", what: `Waiting for ${w.name}` });
    try {
      const a = await connect(cfg, w.provider);
      setWallet(w);
      setAccount(a);
      setChainOk(true);
      try { localStorage.setItem(REMEMBER, w.id); } catch { /* storage blocked */ }
      await loadHeld(a);
      setFlow({ step: "idle" });
    } catch (e) { setFlow({ step: "error", message: explain(e) }); }
  }
  const startConnect = () => {
    if (wallets?.length === 1) void doConnect(wallets[0]);
    else setChooser(!chooser);
  };
  function disconnect() {
    setWallet(null);
    setAccount(null);
    setHeld(null);
    setFlow({ step: "idle" });
    try { localStorage.removeItem(REMEMBER); } catch { /* storage blocked */ }
  }
  async function doSwitch() {
    if (!cfg || !wallet) return;
    setFlow({ step: "busy", what: `Switching to ${cfg.chainName}` });
    try { await ensureChain(cfg, wallet.provider); setChainOk(true); setFlow({ step: "idle" }); } catch (e) { setFlow({ step: "error", message: explain(e) }); }
  }

  async function doApprove() {
    if (!cfg?.lab || !account || !wallet || cost === null) return;
    try {
      setFlow({ step: "busy", what: "Approve in your wallet" });
      const tx = await send(cfg, wallet.provider, account, cfg.lab.token, approveData(cfg.lab.address, cost));
      setFlow({ step: "busy", what: "Waiting for the approval to land" });
      const r = await receipt(cfg, tx);
      if (!r.ok) throw new Error("The approval failed on chain.");
      await loadHeld(account);
      setFlow({ step: "idle" });
    } catch (e) { setFlow({ step: "error", message: explain(e) }); }
  }

  async function doBreed() {
    if (!cfg?.lab || !account || !wallet || !pa || !pb) return;
    const data = breedData(pickRef(pa), pickRef(pb));
    setFlow({ step: "busy", what: "Checking with the contract" });
    const why = await simulate(cfg, account, cfg.lab.address, data);
    if (why) { setFlow({ step: "error", message: why }); return; }
    try {
      setFlow({ step: "busy", what: "Confirm the breeding in your wallet" });
      const tx = await send(cfg, wallet.provider, account, cfg.lab.address, data);
      setFlow({ step: "busy", what: "Burning $CHORD and recording the child" });
      const r = await receipt(cfg, tx);
      if (!r.ok) throw new Error("The breeding failed on chain. Nothing was burned.");
      setFlow({ step: "done", id: bredIdIn(r.logs), tx });
      void loadHeld(account);
      void refreshLab();
    } catch (e) { setFlow({ step: "error", message: explain(e) }); }
  }

  const list = useMemo(() => {
    if (!lab) return [];
    let l = lab.list;
    if (filter === "mine") l = l.filter((b) => account && b.breeder.toLowerCase() === account.toLowerCase());
    else if (filter !== "all") l = l.filter((b) => b.status === filter);
    if (order === "best") l = [...l].filter((b) => b.result).sort((a, b) => b.result!.fitness - a.result!.fitness);
    return l;
  }, [lab, filter, order, account]);
  const bornBrains = lab?.list.filter((b) => b.status !== "bred") ?? [];
  const opened = lab?.list.find((b) => b.id === open) ?? null;

  /* ------------------------------------------------------------ render */

  const enoughChord = held && cost !== null ? held.balance >= cost : false;
  const approved = held && cost !== null ? held.allowance >= cost : false;
  const busy = flow.step === "busy";

  let action: React.ReactNode;
  if (!cfg?.lab) action = <button className="labGo" disabled>Opens soon</button>;
  else if (lab?.closed) action = <button className="labGo" disabled>The Lab is closed</button>;
  else if (!account) action = wallets === null
    ? <button className="labGo" disabled>Looking for wallets…</button>
    : wallets.length === 0
      ? <div className="noWallet"><b>No wallet found in this browser</b><span>Install Rabby, MetaMask or any EVM wallet, or open this page in your wallet app’s browser.</span><a className="enter ghost tiny" href="https://metamask.app.link/dapp/www.notochord.live/lab/">Open in MetaMask mobile</a></div>
      : <button className="labGo primary" onClick={startConnect} disabled={busy} aria-expanded={chooser}>Connect wallet</button>;
  else if (!chainOk) action = <button className="labGo primary" onClick={doSwitch} disabled={busy}>Switch to {cfg.chainName}</button>;
  else if (problem) action = <button className="labGo" disabled>{problem}</button>;
  else if (held && !enoughChord) action = <button className="labGo" disabled>Not enough $CHORD</button>;
  else if (lab && lab.tomorrowCount >= lab.cap) action = <button className="labGo" disabled>Tomorrow is full</button>;
  else if (!approved) action = <button className="labGo primary" onClick={doApprove} disabled={busy || !held}>1 · Allow the Lab to burn {cost !== null ? chord(cost) : ""} $CHORD</button>;
  else action = <button className="labGo hot" onClick={doBreed} disabled={busy}>2 · Burn {cost !== null ? chord(cost) : ""} $CHORD and breed</button>;

  return (
    <article className="lab">
      <header className="labHero">
        <div>
          <p className="labKicker"><span className={cfg?.lab ? "dot live" : "dot"} />{cfg?.lab ? (lab?.closed ? "Closed to new breeding" : "Open") : "Opening soon"}</p>
          <h1>The Lab</h1>
          <p className="labLede">Breed a new brain from the experiment’s fossils. Pick two parents, burn $CHORD, and your brain is born tonight and races the market tomorrow. The experiment itself never sees it.</p>
        </div>
        <dl className="labStats">
          <div><dt>Brains bred</dt><dd>{lab ? lab.brains.toLocaleString("en-US") : "–"}</dd></div>
          <div><dt>$CHORD burned</dt><dd>{lab ? chord(lab.burned) : "–"}</dd></div>
          <div><dt>Places for tomorrow</dt><dd>{lab ? <>{lab.cap - lab.tomorrowCount}<small> of {lab.cap}</small></> : <>{PLANNED.cap}<small> a day</small></>}</dd></div>
          {cfg?.lab ? <div><dt>Next birth in</dt><dd>{birth !== null && now !== null ? span(birth - now) : "–"}</dd></div> : <div><dt>Cost per child</dt><dd>{PLANNED.cost}<small>$CHORD</small></dd></div>}
        </dl>
      </header>

      <ol className="labCycle" aria-label="One child, start to finish">
        <li><b>Breed</b><span>today, any time</span><p>Pick two parents and burn {cost !== null ? chord(cost) : PLANNED.cost} $CHORD.</p></li>
        <li><b>Birth</b><span>00:01 UTC</span><p>A public random draw mixes the parents’ genes. Nobody can know the child in advance.</p></li>
        <li><b>Race</b><span>the next 24 hours</span><p>Your brain trades live HYPE on paper, one decision an hour.</p></li>
        <li><b>Result</b><span>01:00 UTC after</span><p>Its score is written on chain next to your address.</p></li>
      </ol>

      {/* ------------------------------------------------ step 1 */}
      <section className={`labStep ${pa && pb ? "done" : "now"}`} aria-labelledby="step1">
        <header className="stepHead">
          <span className="stepNo">{pa && pb ? "✓" : "1"}</span>
          <div>
            <h2 id="step1">Pick two parents</h2>
            <p>Every disc is a brain from the experiment, saved on chain with all its genes. Click one filled disc for parent <b className="ta">A</b> and another for parent <b className="tb">B</b>. Click again to remove it.</p>
          </div>
          <div className="pickState" aria-live="polite">
            <span className={pa ? "on a" : ""}><i>A</i>{pa ? pickName(pa) : "not chosen"}</span>
            <span className={pb ? "on b" : ""}><i>B</i>{pb ? pickName(pb) : "not chosen"}</span>
          </div>
        </header>

        <div className="pickerBar">
          <div className="seg pickerTabs" role="group" aria-label="Population">
            {cfg?.sources.map((s, i) => <button key={s.replicate} aria-pressed={source === i} onClick={() => setSource(i)}>Population {s.replicate}</button>)}
            {bornBrains.length > 0 && <button aria-pressed={source === "lab"} onClick={() => setSource("lab")}>Lab brains</button>}
          </div>
          {source !== "lab" && gens && gens.size > 0 && (
            <div className="genChips" role="group" aria-label="Fossil generation">
              <span className="dim small">Generation</span>
              {[...gens.keys()].map((g) => <button key={g} aria-pressed={generation === g} onClick={() => setGeneration(g)}>{g}</button>)}
            </div>
          )}
        </div>
        <p className="pickerHelp">
          {source === "lab"
            ? "Brains already born in the Lab. Breeding from them adds a new generation to their family tree."
            : <>Six populations evolve side by side; any of them can be a parent. A new fossil layer is saved every 10 generations, and the newest is the most evolved. {gens && gens.size === 1 ? "Generation 0 is the starting population: the experiment began today." : ""}</>}
        </p>

        {source !== "lab" && (
          <ul className="wellKey">
            <li><i className="kFill" /><b>Evolving brains</b> raced and selected by the market every day</li>
            <li><i className="kRing" /><b>Control brains</b> kept unchanged for comparison. They cannot be parents.</li>
          </ul>
        )}

        {source !== "lab" && !gens && <div className="labEmpty slim"><b>{failed ? "Elysium did not answer. Trying again in a minute." : "Reading the fossils from chain…"}</b></div>}
        {source !== "lab" && gens && gens.size === 0 && <div className="labEmpty slim"><b>No fossils from this population are on chain yet.</b></div>}
        {source !== "lab" && gens && generation !== null && gens.get(generation) && (
          <div className="fossilPlate">
            {gens.get(generation)!.map((f) => {
              const k = pickKey({ kind: "fossil", fossil: f });
              const tag = k === pickKey(pa) ? "A" : k === pickKey(pb) ? "B" : "";
              return (
                <button key={f.id} className={`fossilWell ${f.control ? "control" : ""} ${tag ? `on ${tag}` : ""}`} style={{ "--c": wellColor(f.genomeHash) } as React.CSSProperties}
                  onClick={() => !f.control && choose({ kind: "fossil", fossil: f })} aria-pressed={!!tag} disabled={f.control !== false}
                  title={f.control ? `Specimen ${f.id}: control brain, kept only for comparison. It cannot be a parent.` : `Specimen ${f.id}: evolving brain`}>
                  <span>{tag || f.id}</span>
                </button>
              );
            })}
          </div>
        )}
        {source === "lab" && (
          <div className="fossilPlate">
            {bornBrains.map((b) => {
              const k = pickKey({ kind: "lab", brain: b });
              const tag = k === pickKey(pa) ? "A" : k === pickKey(pb) ? "B" : "";
              return (
                <button key={b.id} className={`fossilWell labWell ${tag ? `on ${tag}` : ""}`} style={{ "--c": wellColor(b.genomeHash!) } as React.CSSProperties} onClick={() => choose({ kind: "lab", brain: b })} aria-pressed={!!tag} title={`Lab brain ${b.id}`}>
                  <span>{tag || b.id}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------ step 2 */}
      <section className={`labStep ${pa && pb ? "now" : "later"}`} aria-labelledby="step2">
        <header className="stepHead">
          <span className="stepNo">2</span>
          <div>
            <h2 id="step2">See what the child can inherit</h2>
            <p>Each square is one gene. Where both parents have the same gene, the child gets it. Where they differ, tonight’s draw picks one of the two, and about 1 in 100 genes mutates.</p>
          </div>
        </header>
        <div className="labBench">
          {[0, 1].map((i) => {
            const p = picks[i];
            return (
              <div key={i} className={`parent ${i ? "b" : "a"} ${p ? "set" : ""}`}>
                <div className="parentHead">
                  <span className="tag">{i ? "B" : "A"}</span>
                  <div>
                    <b>{p ? pickName(p) : `Parent ${i ? "B" : "A"}`}</b>
                    <span>{p ? (p.kind === "fossil" ? `Population ${p.fossil.replicate} · ${p.fossil.control ? "control" : "evolving"} · generation ${p.fossil.generation}` : `Lab brain, day ${p.brain.day}`) : "Not chosen yet"}</span>
                  </div>
                  {p && <button className="clear" onClick={() => choose(p)} aria-label={`Remove parent ${i ? "B" : "A"}`}>×</button>}
                </div>
                {!p ? <div className="labGenome note">Pick a disc in step 1</div>
                  : p.kind === "lab" ? <div className="labGenome note">A Lab brain’s genes are rebuilt from its parents and its draw by anyone who runs the verifier.</div>
                  : <GenomeCanvas genome={genomes[i]} label={`Genome of parent ${i ? "B" : "A"}`} />}
                {p?.kind === "fossil" && (
                  <p className={`hashCheck ${genomes[i] ? "ok" : ""}`} title={p.fossil.genomeHash}>
                    {genomes[i] ? <>✓ Genes read from chain and checked in your browser</> : <><span className="spin" />Reading the genes from chain…</>}
                  </p>
                )}
              </div>
            );
          })}
          <div className="child">
            <div className="parentHead">
              <span className="tag c">?</span>
              <div><b>The child</b><span>{birth !== null ? `Genes decided at ${utc(birth)}` : "…"}</span></div>
            </div>
            {agreement ? <ChildCanvas a={genomes[0]} b={genomes[1]} /> : <div className="labGenome note">Choose both parents to see the child</div>}
            <ul className="childKey">
              <li><i className="sw same" />same in both parents, certain <b>{agreement ? agreement.same.toLocaleString("en-US") : "–"}</b></li>
              <li><i className="sw open" />different, decided by the draw <b>{agreement ? agreement.differ.toLocaleString("en-US") : "–"}</b></li>
              <li><i className="sw mut" />new mutations, about 1% <b>{agreement ? `~${Math.round(agreement.size / 100)}` : "–"}</b></li>
            </ul>
            {round !== null && <p className="drandNote">The draw is drand round <a href={drandUrl(round)} target="_blank" rel="noreferrer">{round.toLocaleString("en-US")}</a>, published by the League of Entropy.</p>}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ step 3 */}
      <section className={`labStep ${flow.step === "done" ? "done" : pa && pb ? "now" : "later"}`} aria-labelledby="step3">
        <header className="stepHead">
          <span className="stepNo">{flow.step === "done" ? "✓" : "3"}</span>
          <div>
            <h2 id="step3">Burn and breed</h2>
            <p>Connect a wallet that holds $CHORD on Elysium. You sign two transactions: first you allow the Lab to burn exactly {cost !== null ? chord(cost) : PLANNED.cost} $CHORD, then you breed.</p>
          </div>
        </header>
        <div className="breedPanel">
          <dl className="breedSummary">
            <div><dt>Parents</dt><dd>{pa && pb ? <>{pickName(pa)} <i>×</i> {pickName(pb)}</> : "pick two in step 1"}</dd></div>
            <div><dt>You burn</dt><dd>{cost !== null ? chord(cost) : PLANNED.cost} $CHORD, sent to the dead address</dd></div>
            <div><dt>Born</dt><dd>{birth !== null ? utc(birth) : "…"}</dd></div>
            <div><dt>Races</dt><dd>{tomorrow !== null ? `${utc(tomorrow).slice(0, 10)}, all day` : "…"}</dd></div>
            <div><dt>Result</dt><dd>{tomorrow !== null ? `${utc(tomorrow + DAY + 3_600_000)}` : "…"}</dd></div>
          </dl>
          <div className="actionArea">
            {account && wallet && (
              <div className="walletChip">
                {wallet.icon ? <img src={wallet.icon} alt="" width={20} height={20} /> : <span className="walletDot" />}
                <span className="walletWho"><b>{short(account)}</b>{held ? `${chord(held.balance)} $CHORD` : chainOk ? "reading balance…" : "wrong network"}</span>
                <button className="linkish" onClick={disconnect}>Disconnect</button>
              </div>
            )}
            {action}
            {chooser && !account && wallets && wallets.length > 1 && (
              <ul className="walletList" aria-label="Choose a wallet">
                {wallets.map((w) => (
                  <li key={w.id}>
                    <button onClick={() => doConnect(w)} disabled={busy}>
                      {w.icon ? <img src={w.icon} alt="" width={24} height={24} /> : <span className="walletDot" />}
                      {w.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="flowNote" aria-live="polite">
              {flow.step === "busy" && <><span className="spin" />{flow.what}…</>}
              {flow.step === "error" && <span className="bad">{flow.message}</span>}
              {flow.step === "done" && <span className="ok">Done. Lab brain {flow.id ?? ""} is yours and is born at 00:01 UTC. <a href={`#brain-${flow.id ?? ""}`} onClick={() => flow.id && setOpen(flow.id)}>See it below</a></span>}
              {flow.step === "idle" && (cfg?.lab
                ? (account ? (chainOk ? (pa && pb ? "Ready. Your wallet will ask you to confirm." : "Now pick two parents in step 1.") : "Your wallet is on another network.") : "Works with Rabby, MetaMask and any EVM wallet.")
                : `Opens soon. Nothing can be burned until the Lab contract is live.`)}
            </p>
          </div>
        </div>
      </section>

      {lab && lab.list.length > 0 && cfg && <BredPerDay list={lab.list} cfg={cfg} />}

      <section className="labBrains" aria-label="Lab brains">
        <div className="pickerBar">
          <h2>Lab brains</h2>
          {lab && lab.list.length > 0 && (
            <div className="brainControls">
              <div className="seg" role="group" aria-label="Show">
                {(["all", "mine", "bred", "born", "raced"] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} disabled={f === "mine" && !account}>{{ all: "All", mine: "Yours", bred: "Waiting", born: "Racing", raced: "Raced" }[f]}</button>)}
              </div>
              <div className="seg" role="group" aria-label="Order">
                <button aria-pressed={order === "new"} onClick={() => setOrder("new")}>Newest</button>
                <button aria-pressed={order === "best"} onClick={() => setOrder("best")}>Best fitness</button>
              </div>
            </div>
          )}
        </div>
        {!cfg?.lab ? (
          <div className="labEmpty"><b>No Lab brains yet</b><p>The first children appear here the day the Lab opens, each with its parents, its drand round and, a day later, its race.</p></div>
        ) : !lab ? (
          <div className="labEmpty"><b>{failed ? "Elysium did not answer" : "Reading the Lab…"}</b></div>
        ) : list.length === 0 ? (
          <div className="labEmpty"><b>{lab.list.length ? "Nothing here with this filter" : "No brains bred yet"}</b><p>{lab.list.length ? "" : "Be the first: pick two fossils above."}</p></div>
        ) : (
          <div className="brainList">
            {list.slice(0, 120).map((b, rank) => (
              <div key={b.id} id={`brain-${b.id}`} className={`brainRow ${open === b.id ? "open" : ""}`}>
                <button className="brainSum" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                  <span className="bid">{order === "best" ? <em>{rank + 1}</em> : null}Lab {b.id}</span>
                  <span className={`chip ${b.status}`}>{{ bred: "Waiting for birth", born: "Racing", raced: "Raced" }[b.status]}</span>
                  <span className="bpar">{refName(b.parents[0], cfg)} <i>×</i> {refName(b.parents[1], cfg)}</span>
                  <span className="bday">{utc(dayStart(cfg, b.day)).slice(0, 10)}</span>
                  <span className={`bfit ${b.result ? (b.result.fitness >= 0 ? "buy" : "sell") : ""}`}>{b.result ? fmtBps(b.result.fitness) : "–"}</span>
                </button>
                {open === b.id && opened && (
                  <div className="brainDetail">
                    <FamilyTree brain={opened} all={lab.list} cfg={cfg} />
                    <dl className="facts small">
                      <div><dt>Breeder</dt><dd><code>{short(b.breeder)}</code></dd></div>
                      <div><dt>Burned</dt><dd>{chord(b.burned)} $CHORD · <code title={b.tx}>{short(b.tx)}</code></dd></div>
                      <div><dt>drand round</dt><dd><a href={drandUrl(b.drandRound)} target="_blank" rel="noreferrer">{b.drandRound.toLocaleString("en-US")}</a></dd></div>
                      <div><dt>Race day</dt><dd>{utc(dayStart(cfg, b.day))} to {utc(dayStart(cfg, b.day + 1))}</dd></div>
                      <div><dt>Genome hash</dt><dd><code>{b.genomeHash ? short(b.genomeHash) : "after birth"}</code></dd></div>
                      {b.result && <>
                        <div><dt>Return after fees</dt><dd className={b.result.pnl >= 0 ? "buy" : "sell"}>{fmtBps(b.result.pnl)}</dd></div>
                        <div><dt>Deepest drawdown</dt><dd>{fmtBps(-b.result.maxDrawdown)}</dd></div>
                        <div><dt>Fitness</dt><dd>{fmtBps(b.result.fitness)}</dd></div>
                      </>}
                    </dl>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="labTrust">
        <details className="more">
          <summary>What the Lab can never do</summary>
          <ul>
            <li><b>Touch the experiment.</b> It only reads fossils. The experiment’s contracts and its protocol hash know nothing of the Lab.</li>
            <li><b>Hold your tokens.</b> $CHORD goes from your wallet to <code>{short(DEAD)}</code> in the same transaction.</li>
            <li><b>Change its terms.</b> Cost, daily cap, token and operator are fixed when the contract is deployed. It can only be closed to new breeding.</li>
            <li><b>Pay anything out.</b> There are no prizes. A good race is a record, nothing more.</li>
          </ul>
        </details>
        <details className="more">
          <summary>Check it yourself</summary>
          <p>Births and results are written by the Lab’s own wallet, separate from the experiment’s. The contract makes sure a birth cannot be written before its drand round exists, or a result before its day has closed. To check the rest, rebuild every child and every race from public data:</p>
          <pre className="command"><code>npm run lab:verify -- --manifest site/public/live/lab.json</code></pre>
          <p className="dim small">It reads the Lab’s events, the fossils, drand and Hyperliquid’s candles, and needs no wallet. <a href="https://github.com/NotochordLabs/notochord/blob/main/lab/RULES.md" target="_blank" rel="noreferrer">Full rules</a>{cfg?.lab && <> · contract <code>{short(cfg.lab.address)}</code></>}.</p>
        </details>
      </section>
      <p className="labNotice">$CHORD burned in the Lab is gone for good and buys no claim on anything. A Lab brain’s race says nothing about the experiment’s result.</p>
    </article>
  );
}
