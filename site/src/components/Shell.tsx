"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LiveStatus, { SimChip } from "@/components/LiveStatus";
import { dateOf, ExperimentProvider, fmt, GENERATIONS, REPLICATES, useExperiment } from "@/lib/store";

/** Reading pages have nothing that moves with the generation, so they get no time bar. */
const NO_TIME_BAR = ["/cells/", "/report/", "/protocol/", "/verify/", "/chord/"];

const NAV = [
  ["/", "Observatory"],
  ["/selection/", "Selection day"],
  ["/population/", "Population"],
  ["/genome/", "Genome"],
  ["/lineage/", "Lineage"],
  ["/fossils/", "Fossils"],
  ["/ledger/", "Ledger"],
  ["/cells/", "Cell atlas"],
  ["/report/", "Report"],
  ["/protocol/", "Protocol"],
  ["/verify/", "Verify"],
  ["/chord/", "$CHORD"],
];

function TimeMachine() {
  const { gen, setGen, rep, setRep, playing, setPlaying, archive, market } = useExperiment();
  const row = archive?.generations[gen];
  const path = useMemo(() => {
    if (!market) return "";
    const xs = market.close.slice(0, market.holdoutOffset);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const step = Math.max(1, Math.floor(xs.length / 400));
    let d = "";
    for (let i = 0; i < xs.length; i += step) d += `${i ? "L" : "M"}${((i / xs.length) * 1000).toFixed(1)} ${(36 - ((xs[i] - lo) / (hi - lo)) * 32).toFixed(1)}`;
    return d;
  }, [market]);
  const start = () => {
    if (gen >= GENERATIONS - 1) setGen(0);
    setPlaying(!playing);
  };
  return (
    <div className="timeBar" role="group" aria-label="Time machine">
      <button className="play" onClick={start} aria-label={playing ? "Pause" : "Play the experiment"}>
        {playing ? <svg viewBox="0 0 12 12" width="12"><rect x="2" y="1" width="3" height="10" fill="currentColor" /><rect x="7" y="1" width="3" height="10" fill="currentColor" /></svg>
          : <svg viewBox="0 0 12 12" width="12"><path d="M2 1l9 5-9 5z" fill="currentColor" /></svg>}
      </button>
      <div className="genRead">
        <b>Generation {gen}</b>
        <span>{row ? `${dateOf(row.t)}, HYPE ${row.m > 0 ? "+" : ""}${fmt(row.m)} bps` : "Loading"}</span>
      </div>
      <div className="scrub">
        <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
          <path d={path} fill="none" stroke="#3b466e" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          {Array.from({ length: 11 }, (_, i) => (i === 10 ? 99 : i * 10)).map((g) => (
            <line key={g} x1={(g / 99) * 1000} x2={(g / 99) * 1000} y1={32} y2={40} stroke="#6d779c" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <input type="range" min={0} max={GENERATIONS - 1} value={gen} aria-label="Generation" onChange={(e) => { setPlaying(false); setGen(Number(e.target.value)); }} />
      </div>
      <div className="reps" role="group" aria-label="Replicate">
        <span>Replicate</span>
        {REPLICATES.map((r) => <button key={r} aria-pressed={rep === r} onClick={() => setRep(r)}>{r}</button>)}
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const bar = !NO_TIME_BAR.includes(pathname);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  return (
    <div className={bar ? "app" : "app noBar"}>
      <nav className="rail" aria-label="Sections">
        <Link href="/" className="brand"><img src="/logo.png" alt="" width="36" height="36" /><div><b>Notochord</b><span>Experiment 177</span></div></Link>
        <SimChip />
        <button className="menuBtn" aria-expanded={menuOpen} aria-controls="siteMenu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "Close" : "Menu"}</button>
        <ul id="siteMenu" className={menuOpen ? "open" : ""}>
          {NAV.map(([href, label]) => (
            <li key={href}><Link href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link></li>
          ))}
          <li><a href="https://x.com/notochordx" target="_blank" rel="noreferrer">X</a></li>
        </ul>
        <LiveStatus />
      </nav>
      <div className="stage">{children}</div>
      {bar && <TimeMachine />}
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ExperimentProvider>
      <Frame>{children}</Frame>
    </ExperimentProvider>
  );
}
