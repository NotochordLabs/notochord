"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export interface PopRow { i: number[]; f: number[]; p: number[]; d: number[]; t: number[]; e: number[] }
export interface GenRow { t: number; m: number; s: PopRow; c: PopRow; out: number[] }
export interface SpecimenRow { id: number; c: 0 | 1; b: number; p: [number, number] | null; x: number | null; h: string }
export interface Archive {
  generations: GenRow[];
  holdout: { m: number; s: PopRow; c: PopRow };
  specimens: SpecimenRow[];
}
export interface Market { firstTime: number; holdoutOffset: number; r1: number[]; r4: number[]; dv: number[]; ret: number[]; close: number[] }
export const REPLICATES = [1, 2, 3, 4, 5, 6];
export const GENERATIONS = 100;

interface State {
  rep: number;
  setRep: (r: number) => void;
  gen: number;
  setGen: (g: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  selected: number | null;
  setSelected: (id: number | null) => void;
  archive: Archive | null;
  market: Market | null;
  specimen: (id: number) => SpecimenRow | undefined;
  /** Where a specimen stands in the chosen generation, if it is alive then. */
  standing: (id: number) => { population: "selection" | "control"; f: number; p: number; d: number; t: number; e: number } | null;
}

const Ctx = createContext<State | null>(null);
const cache = new Map<number, Archive>();

export function ExperimentProvider({ children }: { children: React.ReactNode }) {
  const [rep, setRep] = useState(1);
  const [gen, setGen] = useState(99);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [archive, setArchive] = useState<Archive | null>(null);
  const [market, setMarket] = useState<Market | null>(null);

  useEffect(() => {
    fetch("/archive/market.json").then((r) => r.json()).then(setMarket);
  }, []);
  useEffect(() => {
    let live = true;
    const done = (a: Archive) => live && setArchive(a);
    const hit = cache.get(rep);
    if (hit) done(hit);
    else {
      setArchive(null);
      fetch(`/archive/r${rep}.json`).then((r) => r.json()).then((a: Archive) => {
        cache.set(rep, a);
        done(a);
      });
    }
    return () => {
      live = false;
    };
  }, [rep]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setGen((g) => {
        if (g >= GENERATIONS - 1) {
          setPlaying(false);
          return g;
        }
        return g + 1;
      });
    }, 450);
    return () => clearInterval(id);
  }, [playing]);

  const row = archive?.generations[gen];

  // Keep a living specimen selected as the generation moves: the day's top scorer by default.
  useEffect(() => {
    if (!row) return;
    const alive = selected !== null && (row.s.i.includes(selected) || row.c.i.includes(selected));
    if (alive) return;
    let best = 0;
    row.s.f.forEach((f, i) => {
      if (f > row.s.f[best]) best = i;
    });
    setSelected(row.s.i[best]);
  }, [row, selected]);

  const value = useMemo<State>(() => {
    const byId = new Map(archive?.specimens.map((s) => [s.id, s]));
    return {
      rep,
      setRep: (r) => {
        setSelected(null);
        setRep(r);
      },
      gen,
      setGen,
      playing,
      setPlaying,
      selected,
      setSelected,
      archive,
      market,
      specimen: (id) => byId.get(id),
      standing: (id) => {
        if (!row) return null;
        for (const [population, pop] of [["selection", row.s], ["control", row.c]] as const) {
          const k = pop.i.indexOf(id);
          if (k >= 0) return { population, f: pop.f[k], p: pop.p[k], d: pop.d[k], t: pop.t[k], e: pop.e[k] };
        }
        return null;
      },
    };
  }, [rep, gen, playing, selected, archive, market, row]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExperiment() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useExperiment outside provider");
  return v;
}

export const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
export const signed = (x: number) => `${x > 0 ? "+" : ""}${fmt(x)}`;
export const dateOf = (t: number) => new Date(t).toISOString().slice(0, 10);
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const decisionWord = (d: number) => (d === 1 ? "buy" : d === -1 ? "sell" : "hold");
/* Diverging colour: magenta below zero, dim at zero, green above. */
export function fitnessColor(f: number, scale: number) {
  const t = Math.max(-1, Math.min(1, f / scale));
  const base = [24, 30, 52];
  const to = t >= 0 ? [70, 224, 140] : [255, 92, 154];
  const k = Math.sqrt(Math.abs(t));
  return `rgb(${base.map((b, i) => Math.round(b + (to[i] - b) * k)).join(",")})`;
}
