"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadGenome, loadWiring, replay } from "@/lib/engine";
import { dateOf, fitnessColor, fmt, GENERATIONS, mean, signed, useExperiment, type GenRow } from "@/lib/store";

type Phase = "market" | "judged" | "eliminated" | "born";
const DURATION: Record<Phase, number> = { market: 9000, judged: 3200, eliminated: 3200, born: 4200 };
const ORDER: Phase[] = ["market", "judged", "eliminated", "born"];
const COPY: Record<Phase, string> = {
  market: "The market runs for 24 hours. Every brain decides once an hour.",
  judged: "The day closes. Each brain gets its fitness: return minus half its deepest drawdown.",
  eliminated: "The lower half of the selection group is removed. In the control group, chance decides.",
  born: "Each survivor breeds with another survivor. Genes mix, 1% mutate, and a new generation begins.",
};

const CELL = 34;
const COLS = 16;
/* Control sits on its own rows below the selection group. */
const place = (slot: number) => (slot < 64
  ? { x: (slot % COLS) * CELL + CELL / 2, y: Math.floor(slot / COLS) * CELL + CELL / 2 }
  : { x: ((slot - 64) % COLS) * CELL + CELL / 2, y: 4 * CELL + 30 + CELL / 2 });

export default function Selection() {
  const { archive, gen, setGen, setPlaying, specimen, setSelected, rep, market } = useExperiment();
  const [decisions, setDecisions] = useState<Map<number, number[]> | null>(null);
  const [phase, setPhase] = useState<Phase>("market");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [log, setLog] = useState<{ g: number; text: string; kind: "out" | "born" | "day" }[]>([]);
  const slots = useRef(new Map<number, number>());
  const owner = useRef("");
  const reduced = useRef(false);

  const row: GenRow | undefined = archive?.generations[gen];
  const last = gen >= GENERATIONS - 1;

  useEffect(() => {
    setPlaying(false);
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setRunning(!reduced.current);
    // A replay starts mid-experiment unless one was chosen on the time machine.
    if (gen >= GENERATIONS - 1) setGen(40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable wells: a child takes the place of an eliminated specimen, as if in the same plate.
  if (row) {
    const key = `${row.s.i[0]}-${row.c.i[0]}-${archive?.specimens.length}`;
    const all = [...row.s.i, ...row.c.i];
    if (owner.current !== key && !all.every((id) => slots.current.has(id))) {
      const used = new Set<number>();
      all.forEach((id) => {
        const s = slots.current.get(id);
        if (s !== undefined) used.add(s);
      });
      const free = (from: number, to: number) => {
        for (let i = from; i < to; i++) if (!used.has(i)) return i;
        return -1;
      };
      const next = new Map<number, number>();
      row.s.i.forEach((id) => {
        let s = slots.current.get(id);
        if (s === undefined) s = free(0, 64);
        used.add(s);
        next.set(id, s);
      });
      row.c.i.forEach((id) => {
        let s = slots.current.get(id);
        if (s === undefined) s = free(64, 80);
        used.add(s);
        next.set(id, s);
      });
      slots.current = next;
    }
    owner.current = key;
  }

  // Replicate 1's genomes are public, so the day's real decisions can be computed right here.
  useEffect(() => {
    setDecisions(null);
    if (rep !== 1 || !market || !row) return;
    let live = true;
    (async () => {
      const w = await loadWiring();
      const map = new Map<number, number[]>();
      for (const id of [...row.s.i, ...row.c.i]) {
        const genome = await loadGenome(id);
        if (!live) return;
        map.set(id, replay(w, genome, market, gen * 24, 24).thoughts.map((t) => t.decision));
      }
      if (live) setDecisions(map);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep, market, gen, !!row]);

  const nextRow = archive?.generations[gen + 1];
  const children = useMemo(() => (nextRow && row ? [...nextRow.s.i, ...nextRow.c.i].filter((id) => !row.s.i.includes(id) && !row.c.i.includes(id)) : []), [nextRow, row]);
  const childSlots = useMemo(() => {
    const map = new Map<number, number>();
    if (!row) return map;
    const freed = row.out.map((id) => slots.current.get(id)!);
    const selFree = freed.filter((s) => s < 64).sort((a, b) => a - b);
    const ctlFree = freed.filter((s) => s >= 64).sort((a, b) => a - b);
    children.forEach((id) => {
      const s = specimen(id)?.c ? ctlFree.shift() : selFree.shift();
      if (s !== undefined) map.set(id, s);
    });
    return map;
  }, [children, row, specimen]);

  const advance = () => {
    const at = ORDER.indexOf(phase);
    if (last && phase === "judged") {
      setRunning(false);
      return;
    }
    if (at < ORDER.length - 1) {
      setPhase(ORDER[at + 1]);
      setElapsed(0);
      return;
    }
    // Carry the children's wells into the next generation.
    childSlots.forEach((s, id) => slots.current.set(id, s));
    row?.out.forEach((id) => slots.current.delete(id));
    setPhase("market");
    setElapsed(0);
    setGen(gen + 1);
  };

  useEffect(() => {
    if (!running || !row) return;
    const started = performance.now() - elapsed;
    const id = setInterval(() => {
      const e = performance.now() - started;
      setElapsed(e);
      if (e >= DURATION[phase]) advance();
    }, 80);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase, gen, !!row]);

  // The log only records what has already happened in the replay.
  useEffect(() => {
    if (!row) return;
    if (phase === "eliminated") {
      const worst = row.out
        .map((id) => {
          const inSel = row.s.i.indexOf(id);
          const f = inSel >= 0 ? row.s.f[inSel] : row.c.f[row.c.i.indexOf(id)];
          return { id, f, age: gen - (specimen(id)?.b ?? gen), control: inSel < 0 };
        })
        .filter((x) => !x.control)
        .sort((a, b) => a.f - b.f)
        .slice(0, 3);
      setLog((l) => [
        ...worst.map((w) => ({ g: gen, kind: "out" as const, text: `Specimen ${w.id} eliminated, fitness ${signed(w.f)}, lived ${w.age + 1} ${w.age ? "generations" : "generation"}` })).reverse(),
        { g: gen, kind: "day" as const, text: `Generation ${gen}: ${row.out.length} eliminated` },
        ...l,
      ].slice(0, 40));
    }
    if (phase === "born" && children.length) {
      const first = specimen(children[0]);
      setLog((l) => [
        { g: gen, kind: "born" as const, text: `${children.length} born${first?.p ? `, the first from ${first.p[0]} and ${first.p[1]}` : ""}` },
        ...l,
      ].slice(0, 40));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gen]);

  if (!archive || !row) return <p className="dim pad">Loading the replay.</p>;

  const scale = Math.max(...row.s.f.map(Math.abs), ...row.c.f.map(Math.abs), 1);
  const dayHours = 24;
  const hour = phase === "market" ? Math.min(dayHours, Math.floor((elapsed / DURATION.market) * dayHours)) : dayHours;
  const out = new Set(row.out);
  const showFitness = phase !== "market";
  const gone = phase === "eliminated" || phase === "born";
  const secondsLeft = phase === "market" ? Math.ceil((DURATION.market - elapsed) / 1000) : 0;
  const clockHours = phase === "market" ? String(23 - Math.min(23, hour)).padStart(2, "0") : "00";
  const well = (id: number, f: number) => {
    const slot = slots.current.get(id);
    if (slot === undefined) return null;
    const { x, y } = place(slot);
    const removed = out.has(id);
    const decided = !showFitness ? decisions?.get(id)?.[Math.min(23, hour)] : undefined;
    const dayFill = decided === 1 ? "#46e08c" : decided === -1 ? "#ff5c9a" : "#1a2240";
    return (
      <g key={id} className={`pWell${gone && removed ? " removed" : ""}`} onClick={() => setSelected(id)}>
        <title>{`Specimen ${id}${showFitness ? `, fitness ${f}` : ""}`}</title>
        <circle cx={x} cy={y} r={13} fill={showFitness ? fitnessColor(f, scale) : dayFill} stroke="rgba(255,255,255,.14)" />
        {gone && removed && <path d={`M${x - 7} ${y - 7}L${x + 7} ${y + 7}M${x + 7} ${y - 7}L${x - 7} ${y + 7}`} stroke="#ff5c9a" strokeWidth="1.6" />}
      </g>
    );
  };

  const close = archiveCloses(row, gen, archive.generations);
  return (
    <div className="screen selection">
      <header>
        <h1>Selection day</h1>
        <p>Every day half of the brains are removed for good. This is an accelerated replay of archived, simulated data. The run on Elysium follows the real 24-hour clock: see the <a href="/experiment/">live experiment</a>.</p>
      </header>

      <div className="selBar" aria-live="polite">
        <div className="clock">
          <span>Next selection in</span>
          <b>{phase === "market" ? `${clockHours}:${String(59 - Math.floor(((elapsed / DURATION.market) * dayHours * 60) % 60)).padStart(2, "0")}:00` : "Now"}</b>
          <small>{phase === "market" ? `simulated clock, ${secondsLeft}s of replay` : "selection in progress"}</small>
        </div>
        <div className="steps">
          {ORDER.map((p, i) => <span key={p} className={p === phase ? "on" : ORDER.indexOf(phase) > i ? "done" : ""}>{p === "market" ? "Market" : p === "judged" ? "Fitness" : p === "eliminated" ? "Elimination" : "Birth"}</span>)}
        </div>
        <div className="selControls">
          <button className="enter ghost" onClick={() => setRunning(!running)}>{running ? "Pause" : "Run"}</button>
          <button className="enter ghost" onClick={advance}>Next step</button>
        </div>
      </div>
      <p className="selCopy">{last && phase !== "market" && phase !== "judged" ? "This is the last generation. Selection ends here, and the survivors face the unseen week." : COPY[phase]}</p>

      <div className="twoCol selCols">
        <figure>
          <div className="hourRead">
            {phase === "market" ? (
              <>
                <span>Hour <b>{Math.min(24, hour + 1)}/24</b></span>
                {market && <span>HYPE this hour <b>{signed(market.r1[gen * 24 + Math.min(23, hour)])} bps</b></span>}
                {decisions ? (
                  <ul className="legend">
                    <li><span className="swatch" style={{ background: "#46e08c" }} />buy</li>
                    <li><span className="swatch" style={{ background: "#ff5c9a" }} />sell</li>
                    <li><span className="swatch" style={{ background: "#1a2240" }} />hold</li>
                  </ul>
                ) : <span>{rep === 1 ? "Computing the day’s decisions here…" : "Live decisions are published for replicate 1."}</span>}
              </>
            ) : (
              <ul className="legend">
                <li><span className="swatch" style={{ background: "#46e08c" }} />high fitness</li>
                <li><span className="swatch" style={{ background: "#ff5c9a" }} />low fitness</li>
                <li><span className="swatch" style={{ background: "#18203a" }} />0, no trades</li>
              </ul>
            )}
          </div>
          <svg className="selPlate" viewBox={`0 0 ${COLS * CELL} ${4 * CELL + 30 + CELL}`} role="img" aria-label={`Generation ${gen}. ${phase}.`}>
            <text className="axis" x={0} y={4 * CELL + 20}>Control, 16 specimens. Survivors chosen by chance.</text>
            {phase === "born" && children.map((id) => {
              const s = specimen(id);
              const slot = childSlots.get(id);
              if (!s?.p || slot === undefined) return null;
              const c = place(slot);
              return s.p.map((pid) => {
                const ps = slots.current.get(pid);
                if (ps === undefined) return null;
                const a = place(ps);
                return <line key={`${id}-${pid}`} className="bond" x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="#41d3e6" strokeOpacity=".5" />;
              });
            })}
            {row.s.i.map((id, k) => well(id, row.s.f[k]))}
            {row.c.i.map((id, k) => well(id, row.c.f[k]))}
            {phase === "born" && children.map((id) => {
              const slot = childSlots.get(id);
              if (slot === undefined) return null;
              const { x, y } = place(slot);
              return <circle key={`b${id}`} className="newborn" cx={x} cy={y} r={13} fill="#41d3e6" />;
            })}
          </svg>
          <figcaption>Generation {gen}, {dateOf(row.t)}. Upper plate: selection, 64 specimens, the better half survives.</figcaption>
        </figure>
        <aside className="card selSide">
          <dl className="facts">
            <div><dt>HYPE that day</dt><dd>{signed(row.m)} bps</dd></div>
            <div><dt>Selection mean</dt><dd>{showFitness ? signed(mean(row.s.f)) : "…"}</dd></div>
            <div><dt>Control mean</dt><dd>{showFitness ? signed(mean(row.c.f)) : "…"}</dd></div>
            <div><dt>Selection best</dt><dd>{showFitness ? signed(Math.max(...row.s.f)) : "…"}</dd></div>
            <div><dt>Oldest survivor</dt><dd>{close.oldest ? `${close.oldest.id}, ${close.oldest.age} generations` : "…"}</dd></div>
          </dl>
          <h3>Lab log</h3>
          <ol className="log">
            {log.length === 0 && <li className="dim">Waiting for the first elimination.</li>}
            {log.map((l, i) => <li key={`${l.g}-${i}-${l.text}`} className={l.kind}>{l.text}</li>)}
          </ol>
        </aside>
      </div>
    </div>
  );

  function archiveCloses(r: GenRow, g: number, _all: GenRow[]) {
    let oldest: { id: number; age: number } | null = null;
    for (const id of r.s.i) {
      const b = specimen(id)?.b ?? g;
      if (!r.out.includes(id) && (!oldest || g - b > oldest.age)) oldest = { id, age: g - b };
    }
    void fmt;
    return { oldest };
  }
}
