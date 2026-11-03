"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import data from "@/data/experiment.json";
import { loadGenome, loadWiring, sha256Hex, type Wiring } from "@/lib/engine";
import { dateOf, fitnessColor, fmt, mean, signed, useExperiment, type PopRow, GENERATIONS } from "@/lib/store";

const SEL = "#6e8bff";
const CTL = "#ff5c9a";

function ticks(lo: number, hi: number, n = 4) {
  const raw = (hi - lo) / n || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const smooth = (xs: number[], w = 10) => xs.map((_, i) => mean(xs.slice(Math.max(0, i - w + 1), i + 1)));

export function GenerationChart({ title, a, b, unit, min, max }: { title: string; a: number[]; b: number[]; unit: (v: number) => string; min?: number; max?: number }) {
  const { gen, setGen, setPlaying } = useExperiment();
  const W = 560, H = 230, left = 58, right = 14, top = 12, bottom = 28;
  const lo = min ?? Math.min(...a, ...b, 0), hi = max ?? Math.max(...a, ...b, 0);
  const x = (i: number) => left + (i / (a.length - 1)) * (W - left - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * (H - top - bottom);
  const path = (xs: number[]) => xs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const pick = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.buttons !== 1 && e.type !== "pointerdown") return;
    const box = e.currentTarget.getBoundingClientRect();
    setPlaying(false);
    setGen(Math.max(0, Math.min(a.length - 1, Math.round(((e.clientX - box.left) / box.width) * (a.length - 1)))));
  };
  return (
    <figure>
      <h3>{title}</h3>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: selection ${unit(a[gen])}, control ${unit(b[gen])} at generation ${gen}.`}>
          {ticks(lo, hi).map((v) => (
            <g key={v}>
              <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#6d779c" : "#222a45"} />
              <text className="axis" x={left - 6} y={y(v) + 4} textAnchor="end">{unit(v)}</text>
            </g>
          ))}
          {[0, 25, 50, 75, 99].map((g) => <text key={g} className="axis" x={x(g)} y={H - 8} textAnchor="middle">{g}</text>)}
          <path d={path(b)} fill="none" stroke={CTL} strokeWidth={2} strokeLinejoin="round" />
          <path d={path(a)} fill="none" stroke={SEL} strokeWidth={2} strokeLinejoin="round" />
          <line x1={x(gen)} x2={x(gen)} y1={top} y2={H - bottom} stroke="#e9edf9" />
          <circle cx={x(gen)} cy={y(b[gen])} r={4} fill={CTL} stroke="#060913" strokeWidth={2} />
          <circle cx={x(gen)} cy={y(a[gen])} r={4} fill={SEL} stroke="#060913" strokeWidth={2} />
          <rect x={left} y={top} width={W - left - right} height={H - top - bottom} fill="transparent" style={{ touchAction: "pan-y", cursor: "ew-resize" }} onPointerDown={pick} onPointerMove={pick} />
        </svg>
        <p className="chartRead"><span style={{ color: SEL }}>Selection {unit(a[gen])}</span><span style={{ color: CTL }}>Control {unit(b[gen])}</span></p>
      </div>
    </figure>
  );
}

function Plate({ pop, label, scale }: { pop: PopRow; label: string; scale: number }) {
  const { selected, setSelected, archive, gen } = useExperiment();
  const out = new Set(archive?.generations[gen].out);
  return (
    <div>
      <p className="plateLabel">{label}</p>
      <div className="plate big" role="group" aria-label={label}>
        {pop.i.map((id, k) => {
          const gone = out.has(id);
          return (
            <button
              key={id}
              className={`well${gone ? " gone" : ""}`}
              style={gone ? { boxShadow: `inset 0 0 0 2px ${fitnessColor(pop.f[k], scale)}` } : { background: fitnessColor(pop.f[k], scale) }}
              aria-pressed={selected === id}
              aria-label={`Specimen ${id}, fitness ${pop.f[k]}${gone ? ", eliminated after this generation" : ""}`}
              title={`Specimen ${id}, fitness ${pop.f[k]}${gone ? ", eliminated" : ""}`}
              onClick={() => setSelected(id)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SpecimenCard() {
  const { selected, specimen, standing, setSelected, gen, rep } = useExperiment();
  const router = useRouter();
  if (selected === null) return null;
  const s = specimen(selected);
  const st = standing(selected);
  if (!s || !st) return null;
  return (
    <div className="card">
      <h3>Specimen {selected}</h3>
      <dl className="facts">
        <div><dt>Population</dt><dd>{st.population}</dd></div>
        <div><dt>Born</dt><dd>generation {s.b}</dd></div>
        <div><dt>{s.x === null ? "Status" : "Eliminated"}</dt><dd>{s.x === null ? "alive at the end" : `generation ${s.x}`}</dd></div>
        <div><dt>Parents</dt><dd>{s.p ? s.p.map((id) => <button key={id} className="linkish" onClick={() => setSelected(id)} disabled={!standing(id)}>{id}</button>) : "genesis"}</dd></div>
        <div><dt>Fitness, generation {gen}</dt><dd>{signed(st.f)}</dd></div>
        <div><dt>Return</dt><dd>{signed(st.p)} bps</dd></div>
        <div><dt>Deepest drawdown</dt><dd>{fmt(st.d)} bps</dd></div>
        <div><dt>Position changes</dt><dd>{st.t}</dd></div>
        <div><dt>Time in position</dt><dd>{st.e}%</dd></div>
        <div><dt>Genome</dt><dd><code>{s.h}…</code></dd></div>
      </dl>
      {rep === 1 && (
        <div className="actions">
          <button className="enter" onClick={() => router.push("/")}>Watch it think</button>
          <button className="enter ghost" onClick={() => router.push("/genome/")}>Open its genome</button>
        </div>
      )}
    </div>
  );
}

export function Population() {
  const { archive, gen } = useExperiment();
  const series = useMemo(() => {
    if (!archive) return null;
    const g = archive.generations;
    return {
      s: smooth(g.map((r) => mean(r.s.f))),
      k: smooth(g.map((r) => mean(r.c.f))),
      se: smooth(g.map((r) => mean(r.s.e))),
      ke: smooth(g.map((r) => mean(r.c.e))),
    };
  }, [archive]);
  if (!archive || !series) return <p className="dim pad">Loading the population.</p>;
  const row = archive.generations[gen];
  const scale = Math.max(...row.s.f.map(Math.abs), ...row.c.f.map(Math.abs), 1);
  return (
    <div className="screen">
      <header>
        <h1>Population</h1>
        <p>Each well is one brain, generation {gen}. Each day the better half of the selection group survives. In the control group chance decides. A ring marks a brain eliminated after this generation.</p>
      </header>
      <div className="twoCol">
        <div>
          <Plate pop={row.s} label="Selection, 64 specimens" scale={scale} />
          <Plate pop={row.c} label="Control, 16 specimens" scale={scale} />
          <ul className="legend" style={{ marginTop: "0.75rem" }}>
            <li><span className="swatch" style={{ background: "#46e08c" }} />high fitness</li>
            <li><span className="swatch" style={{ background: "#ff5c9a" }} />low fitness</li>
            <li><span className="swatch" style={{ background: "rgb(24,30,52)" }} />0, no trades that day</li>
          </ul>
        </div>
        <SpecimenCard />
      </div>
      <div className="columns">
        <GenerationChart title="Daily fitness in bps, 10-generation mean" a={series.s} b={series.k} unit={fmt} />
        <GenerationChart title="Time in position, 10-generation mean" a={series.se} b={series.ke} unit={(v) => `${Math.round(v)}%`} min={0} max={100} />
      </div>
    </div>
  );
}

/* ---- genome ---- */
type GeneKind = "inherit-a" | "inherit-b" | "both" | "mutated";
const CELL = 7;

export function Genome() {
  const { selected, specimen, rep, setRep, archive, setSelected } = useExperiment();
  const ref = useRef<HTMLCanvasElement>(null);
  const [wiring, setWiring] = useState<Wiring | null>(null);
  const [genome, setGenome] = useState<Uint8Array | null>(null);
  const [parents, setParents] = useState<[Uint8Array, Uint8Array] | null>(null);
  const [mode, setMode] = useState<"values" | "inheritance">("inheritance");
  const [hover, setHover] = useState<string>("Hover over a gene.");
  const [hash, setHash] = useState<string | null>(null);
  const [fullHash, setFullHash] = useState<string[] | null>(null);
  const s = selected !== null ? specimen(selected) : undefined;
  const cols = 64;

  useEffect(() => {
    loadWiring().then(setWiring);
    fetch("/archive/hashes-r1.json").then((r) => r.json()).then(setFullHash);
  }, []);
  useEffect(() => {
    if (rep !== 1 || !s) return;
    let live = true;
    setHash(null);
    (async () => {
      const g = await loadGenome(s.id);
      const ps = s.p ? await Promise.all(s.p.map(loadGenome)) : null;
      const h = await sha256Hex(g);
      if (!live) return;
      setGenome(g);
      setParents(ps as [Uint8Array, Uint8Array] | null);
      setHash(h);
    })();
    return () => {
      live = false;
    };
  }, [rep, s]);

  const kinds = useMemo(() => {
    if (!genome || !parents) return null;
    const out: GeneKind[] = [];
    for (let i = 0; i < genome.length; i++) {
      const a = parents[0][i] === genome[i], b = parents[1][i] === genome[i];
      out.push(a && b ? "both" : a ? "inherit-a" : b ? "inherit-b" : "mutated");
    }
    return out;
  }, [genome, parents]);
  const counts = useMemo(() => {
    const c = { "inherit-a": 0, "inherit-b": 0, both: 0, mutated: 0 };
    kinds?.forEach((k) => c[k]++);
    return c;
  }, [kinds]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !genome) return;
    const rows = Math.ceil(genome.length / cols);
    canvas.width = cols * CELL;
    canvas.height = rows * CELL;
    const g = canvas.getContext("2d")!;
    const colors: Record<GeneKind, string> = { "inherit-a": "#6e8bff", "inherit-b": "#41d3e6", both: "#2a3350", mutated: "#ff5c9a" };
    genome.forEach((v, i) => {
      const useKinds = mode === "inheritance" && kinds;
      g.fillStyle = useKinds ? colors[kinds![i]] : `rgb(${20 + v * 0.5},${30 + v * 0.75},${60 + v * 0.75})`;
      g.fillRect((i % cols) * CELL, Math.floor(i / cols) * CELL, CELL - 1, CELL - 1);
    });
  }, [genome, kinds, mode]);

  const describe = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!genome || !wiring) return;
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientY - box.top) / box.height) * Math.ceil(genome.length / cols)) * cols + Math.floor(((e.clientX - box.left) / box.width) * cols);
    if (i < 0 || i >= genome.length) return;
    const { edges, neurons } = wiring.layout;
    const v = genome[i];
    const parentsNote = parents ? ` Parents: ${parents[0][i]}, ${parents[1][i]}.` : "";
    if (i < edges) setHover(`Gene ${i}: connection ${wiring.names[wiring.connectome.edgeSrc[i]]} to ${wiring.names[wiring.connectome.edgeDst[i]]}, strength ×${(v / 128).toFixed(2)}.${parentsNote}`);
    else if (i < edges + neurons) setHover(`Gene ${i}: firing threshold of ${wiring.names[i - edges]}, ${48 + v * 4}.${parentsNote}`);
    else setHover(`Gene ${i}: ${wiring.names[i - edges - neurons]} is ${v < 51 ? "inhibitory" : "excitatory"} (value ${v}).${parentsNote}`);
  };

  const expected = s && fullHash ? fullHash[s.id - 1] : null;
  if (rep !== 1) {
    return (
      <div className="screen">
        <header><h1>Genome</h1><p>This preview publishes genomes for replicate 1.</p></header>
        <button className="enter" onClick={() => setRep(1)}>Switch to replicate 1</button>
      </div>
    );
  }
  const mates = s?.p;
  return (
    <div className="screen">
      <header>
        <h1>Genome of specimen {selected}</h1>
        <p>
          {wiring ? `${fmt(wiring.layout.size)} genes: ${fmt(wiring.layout.edges)} connection strengths, then ${wiring.layout.neurons} firing thresholds and ${wiring.layout.neurons} transmitter signs.` : ""} Every square is one gene, read from the archive.
        </p>
      </header>
      <div className="twoCol genomeCols">
        <div>
          <canvas ref={ref} className="genomeGrid" onPointerMove={describe} role="img" aria-label={`Grid of every gene in specimen ${selected}.`} />
          <p className="geneRead" aria-live="polite">{hover}</p>
        </div>
        <div className="card">
          <div className="seg" role="group" aria-label="Colour by">
            <button aria-pressed={mode === "inheritance"} disabled={!kinds} onClick={() => setMode("inheritance")}>Inheritance</button>
            <button aria-pressed={mode === "values"} onClick={() => setMode("values")}>Values</button>
          </div>
          {kinds && mode === "inheritance" ? (
            <ul className="geneCounts">
              <li><span className="swatch" style={{ background: "#2a3350" }} />same in both parents <b>{fmt(counts.both)}</b></li>
              <li><span className="swatch" style={{ background: "#6e8bff" }} />from parent <button className="linkish" onClick={() => setSelected(mates![0])}>{mates?.[0]}</button> <b>{fmt(counts["inherit-a"])}</b></li>
              <li><span className="swatch" style={{ background: "#41d3e6" }} />from parent <button className="linkish" onClick={() => setSelected(mates![1])}>{mates?.[1]}</button> <b>{fmt(counts["inherit-b"])}</b></li>
              <li><span className="swatch" style={{ background: "#ff5c9a" }} />new mutation <b>{fmt(counts.mutated)}</b></li>
            </ul>
          ) : (
            <p className="dim small">{kinds ? "Brighter squares are higher gene values." : "A genesis specimen has random genes and no parents. Brighter squares are higher gene values."}</p>
          )}
          <div className={`verify ${hash && expected && hash !== expected ? "bad" : ""}`}>
            <h3>{hash && expected ? (hash === expected ? "Hash verified in your browser" : "Hash mismatch") : "Hashing"}</h3>
            <code>{hash ?? "…"}</code>
          </div>
          {genome && (
            <a className="enter ghost" download={`specimen-${selected}.bin`} href={URL.createObjectURL(new Blob([genome.slice().buffer as ArrayBuffer]))}>Download raw genome</a>
          )}
          {archive && <p className="dim small">Pick another specimen on the Population or Lineage screen.</p>}
        </div>
      </div>
    </div>
  );
}

/* ---- lineage ---- */
export function Lineage() {
  const { archive, selected, setSelected, gen, specimen } = useExperiment();
  const ref = useRef<HTMLCanvasElement>(null);
  const [hideControl, setHideControl] = useState(true);
  const layout = useMemo(() => {
    if (!archive) return null;
    const rows = new Map<number, number[]>();
    const list = archive.specimens.filter((s) => !hideControl || !s.c);
    list.forEach((s) => rows.set(s.b, [...(rows.get(s.b) ?? []), s.id]));
    const at = new Map<number, [number, number]>();
    rows.forEach((ids, g) => ids.forEach((id, i) => at.set(id, [g, (i + 0.5) / ids.length])));
    return { list, at };
  }, [archive, hideControl]);

  const family = useMemo(() => {
    const up = new Set<number>(), down = new Set<number>();
    if (!archive || selected === null) return { up, down };
    const stack = [selected];
    while (stack.length) {
      const id = stack.pop()!;
      if (up.has(id)) continue;
      up.add(id);
      specimen(id)?.p?.forEach((p) => stack.push(p));
    }
    const kids = new Map<number, number[]>();
    archive.specimens.forEach((s) => s.p?.forEach((p) => kids.set(p, [...(kids.get(p) ?? []), s.id])));
    const queue = [selected];
    while (queue.length) {
      const id = queue.pop()!;
      if (down.has(id)) continue;
      down.add(id);
      kids.get(id)?.forEach((k) => queue.push(k));
    }
    return { up, down };
  }, [archive, selected, specimen]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !layout || !archive) return;
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = box.width * ratio;
    canvas.height = box.height * ratio;
    const g = canvas.getContext("2d")!;
    g.scale(ratio, ratio);
    const X = (b: number) => 18 + (b / 99) * (box.width - 36);
    const Y = (v: number) => 8 + v * (box.height - 16);
    const line = (ids: Set<number>, color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (const s of layout.list) {
        if (!s.p || !ids.has(s.id)) continue;
        const a = layout.at.get(s.id)!;
        for (const p of s.p) {
          const b = layout.at.get(p);
          if (!b || !ids.has(p)) continue;
          g.moveTo(X(b[0]), Y(b[1]));
          g.lineTo(X(a[0]), Y(a[1]));
        }
      }
      g.stroke();
    };
    line(new Set(layout.list.map((s) => s.id)), "rgba(70,86,140,0.07)", 1);
    line(family.up, "rgba(110,139,255,0.55)", 1);
    line(family.down, "rgba(70,224,140,0.45)", 1);
    for (const s of layout.list) {
      const [b, v] = layout.at.get(s.id)!;
      g.fillStyle = s.id === selected ? "#ffffff" : family.up.has(s.id) ? "#8ea4ff" : family.down.has(s.id) ? "#46e08c" : s.x === null ? "#d6dbf0" : "#3a4468";
      const r = s.id === selected ? 4 : family.up.has(s.id) || family.down.has(s.id) ? 2 : 1;
      g.beginPath();
      g.arc(X(b), Y(v), r, 0, 7);
      g.fill();
    }
    g.strokeStyle = "#e9edf9";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X(gen), 0);
    g.lineTo(X(gen), box.height);
    g.stroke();
  }, [layout, family, gen, selected, archive]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!layout) return;
    const box = e.currentTarget.getBoundingClientRect();
    let best = -1, dist = 400;
    for (const s of layout.list) {
      const [b, v] = layout.at.get(s.id)!;
      const d = (18 + (b / 99) * (box.width - 36) - (e.clientX - box.left)) ** 2 + (8 + v * (box.height - 16) - (e.clientY - box.top)) ** 2;
      if (d < dist) {
        dist = d;
        best = s.id;
      }
    }
    if (best > 0) setSelected(best);
  };

  const extinctAt = useMemo(() => {
    if (!archive) return null;
    const firstAlive = archive.specimens.filter((s) => s.b === 0 && !s.c);
    const survivors = firstAlive.filter((s) => {
      const finalIds = new Set(archive.generations[GENERATIONS - 1].s.i);
      const kids = new Map<number, number[]>();
      archive.specimens.forEach((c) => c.p?.forEach((p) => kids.set(p, [...(kids.get(p) ?? []), c.id])));
      const stack = [s.id];
      const seen = new Set<number>();
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (finalIds.has(id)) return true;
        kids.get(id)?.forEach((k) => stack.push(k));
      }
      return false;
    });
    return survivors.length;
  }, [archive]);

  return (
    <div className="screen">
      <header>
        <h1>Lineage</h1>
        <p>
          Every specimen ever born in this replicate, by generation of birth. Click one to trace its ancestors and descendants.
          {extinctAt !== null && ` ${extinctAt} of the 64 founders have descendants in the final population.`}
        </p>
      </header>
      <canvas ref={ref} className="lineageCanvas" onClick={pick} role="img" aria-label="Family tree of every specimen in this replicate." />
      <ul className="legend" style={{ marginTop: "0.6rem" }}>
        <li><span className="swatch" style={{ background: "#fff" }} />selected, specimen {selected}</li>
        <li><span className="swatch" style={{ background: "#8ea4ff" }} />ancestors, {family.up.size - 1}</li>
        <li><span className="swatch" style={{ background: "#46e08c" }} />descendants, {family.down.size - 1}</li>
        <li><label className="toggle"><input type="checkbox" checked={!hideControl} onChange={(e) => setHideControl(!e.target.checked)} />show control</label></li>
      </ul>
      <div className="twoCol lineageInfo"><SpecimenCard /></div>
    </div>
  );
}

/* ---- fossils ---- */
const FOSSIL_GENS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99];

export function Fossils() {
  const { archive, setGen, gen, rep } = useExperiment();
  const [check, setCheck] = useState<Record<number, string>>({});
  const verify = async (g: number) => {
    if (!archive) return;
    setCheck((c) => ({ ...c, [g]: "Hashing…" }));
    const hashes: string[] = await fetch("/archive/hashes-r1.json").then((r) => r.json());
    const row = archive.generations[g];
    let good = 0;
    const ids = [...row.s.i, ...row.c.i];
    for (const id of ids) if ((await sha256Hex(await loadGenome(id))) === hashes[id - 1]) good++;
    setCheck((c) => ({ ...c, [g]: `${good}/${ids.length} genomes match` }));
  };
  if (!archive) return <p className="dim pad">Loading the fossil record.</p>;
  return (
    <div className="screen">
      <header>
        <h1>Fossil record</h1>
        <p>Every 10 generations the full population is preserved, so anyone can rerun the experiment from that point. Rings are the brains eliminated that day. Colour is that day’s fitness.</p>
      </header>
      <div className="strata">
        {FOSSIL_GENS.map((g) => {
          const row = archive.generations[g];
          const scale = Math.max(...row.s.f.map(Math.abs), 1);
          const out = new Set(row.out);
          const f = data.fossils[FOSSIL_GENS.indexOf(g)];
          return (
            <article key={g} className={g === gen ? "stratum on" : "stratum"}>
              <button className="stratumHead" onClick={() => setGen(g)}>
                <b>Generation {g}</b><span>{dateOf(row.t)}</span>
              </button>
              <svg viewBox="0 0 176 88" role="img" aria-label={`Generation ${g}, selection population.`}>
                {row.s.i.map((id, k) => {
                  const gone = out.has(id);
                  const c = fitnessColor(row.s.f[k], scale);
                  return <circle key={id} cx={(k % 16) * 11 + 5.5} cy={Math.floor(k / 16) * 22 + 11} r={4.3} fill={gone ? "none" : c} stroke={gone ? c : "none"}><title>{`Specimen ${id}, fitness ${row.s.f[k]}`}</title></circle>;
                })}
              </svg>
              <dl className="facts small">
                <div><dt>Mean fitness</dt><dd>{signed(mean(row.s.f))}</dd></div>
                <div><dt>Time in position</dt><dd>{Math.round(mean(row.s.e))}%</dd></div>
                {rep === 1 && f && <div><dt>Genes differing, selection</dt><dd>{f.selectionDistance}%</dd></div>}
                {rep === 1 && f && <div><dt>Genes differing, control</dt><dd>{f.controlDistance}%</dd></div>}
              </dl>
              {rep === 1 && <button className="enter ghost tiny" onClick={() => verify(g)}>{check[g] ?? "Verify 80 genomes here"}</button>}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---- ledger ---- */
export function Ledger() {
  const { archive, gen, setGen, specimen } = useExperiment();
  const events = useMemo(() => {
    if (!archive) return [];
    const list = [];
    for (let g = 0; g <= gen; g++) {
      const r = archive.generations[g];
      let best = 0;
      r.s.f.forEach((f, i) => {
        if (f > r.s.f[best]) best = i;
      });
      const born = archive.specimens.filter((s) => s.b === g + 1).length;
      list.push({
        g,
        date: dateOf(r.t),
        market: r.m,
        sel: Math.round(mean(r.s.f)),
        ctl: Math.round(mean(r.c.f)),
        top: r.s.i[best],
        topF: r.s.f[best],
        out: r.out.length,
        born,
        fossil: g % 10 === 0 || g === 99,
      });
    }
    return list.reverse();
  }, [archive, gen]);
  void specimen;
  if (!archive) return <p className="dim pad">Loading the ledger.</p>;
  return (
    <div className="screen">
      <header>
        <h1>Ledger</h1>
        <p>One entry per generation, up to the point on the time machine. This is the record the contracts will store. Transactions appear here once the experiment runs on Elysium; until then every entry is marked simulated.</p>
      </header>
      <div className="tableWrap">
        <table>
          <thead><tr><th className="num">Generation</th><th>Date</th><th className="num">HYPE, bps</th><th className="num">Selection</th><th className="num">Control</th><th>Top specimen</th><th className="num">Eliminated</th><th className="num">Born</th><th>Fossil</th><th>Transaction</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.g} className={e.g === gen ? "current" : ""} onClick={() => setGen(e.g)}>
                <td className="num">{e.g}</td><td>{e.date}</td><td className="num">{signed(e.market)}</td><td className="num">{signed(e.sel)}</td><td className="num">{signed(e.ctl)}</td>
                <td>{e.top} ({signed(e.topF)})</td><td className="num">{e.out}</td><td className="num">{e.born}</td><td>{e.fossil ? "preserved" : ""}</td><td className="dim">simulated</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- protocol figures ---- */
export function HoldoutPlot() {
  const [rows, setRows] = useState<{ k: number; s: number; c: number }[] | null>(null);
  useEffect(() => {
    Promise.all([1, 2, 3, 4, 5, 6].map((k) => fetch(`/archive/r${k}.json`).then((r) => r.json()))).then((all) =>
      setRows(all.map((a, i) => ({ k: i + 1, s: Math.round(mean(a.holdout.s.f)), c: Math.round(mean(a.holdout.c.f)) }))));
  }, []);
  if (!rows) return <p className="dim">Loading.</p>;
  const W = 720, rowH = 46, top = 30, left = 100, right = 20;
  const H = top + rowH * rows.length + 30;
  const vals = rows.flatMap((r) => [r.s, r.c]);
  const lo = Math.min(...vals, 0), hi = Math.max(...vals, 0);
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * (W - left - right);
  return (
    <div className="chart">
      <ul className="legend">
        <li><span className="swatch" style={{ background: SEL }} />selection mean</li>
        <li><span className="swatch diamond" style={{ background: CTL }} />control mean</li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fitness on the unseen week across six replicates. Values are in the table below.">
        {ticks(lo, hi, 5).map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={top - 8} y2={H - 24} stroke={v === 0 ? "#9aa6c9" : "#222a45"} strokeWidth={v === 0 ? 1.5 : 1} />
            <text className="axis" x={x(v)} y={H - 4} textAnchor="middle">{fmt(v)}</text>
          </g>
        ))}
        <text className="axis hideNarrow" x={x(0)} y={top - 12} textAnchor="end">no trading: 0</text>
        {rows.map((r, i) => {
          const y = top + rowH * i + rowH / 2;
          return (
            <g key={r.k}>
              <text className="axis" x={0} y={y + 4}>Replicate {r.k}</text>
              <line x1={x(r.s)} x2={x(r.c)} y1={y} y2={y} stroke="#4a5478" strokeWidth={2} />
              <rect x={x(r.c) - 6} y={y - 6} width={12} height={12} rx={1} fill={CTL} stroke="#060913" strokeWidth={2} transform={`rotate(45 ${x(r.c)} ${y})`} />
              <circle cx={x(r.s)} cy={y} r={7} fill={SEL} stroke="#060913" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      <details>
        <summary>Show the table</summary>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Replicate</th><th className="num">Selection</th><th className="num">Control</th><th className="num">Difference</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.k}><td>{r.k}</td><td className="num">{fmt(r.s)}</td><td className="num">{fmt(r.c)}</td><td className="num">{fmt(r.s - r.c)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const ORDER = ["priceUp", "priceDown", "volume", "other", "motorL", "motorR"];
export function ConnectionMatrix() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cells = data.brain.cells;
    const canvas = ref.current!;
    canvas.width = cells.length;
    canvas.height = cells.length;
    const sorted = cells.map((c, i) => ({ c, i })).sort((a, b) => ORDER.indexOf(a.c.role) - ORDER.indexOf(b.c.role) || a.i - b.i);
    const at = new Map(sorted.map((o, k) => [o.i, k]));
    const g = canvas.getContext("2d")!;
    const colors: Record<string, string> = { priceUp: "#41d3e6", priceDown: "#41d3e6", volume: "#6e8bff", motorL: "#46e08c", motorR: "#46e08c", other: "#8ea4ff" };
    const { edges } = data.brain;
    for (let e = 0; e < edges.length; e += 2) {
      g.fillStyle = colors[cells[edges[e]].role];
      g.fillRect(at.get(edges[e + 1])!, at.get(edges[e])!, 1, 1);
    }
  }, []);
  return <canvas ref={ref} className="matrix" role="img" aria-label="Matrix of the 3,010 directed connections between 216 cells." />;
}
