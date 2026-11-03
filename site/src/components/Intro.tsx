"use client";

import { useEffect, useState } from "react";

export interface Chapter { stage: 0 | 1 | 2; text: string; ms: number }

export const CHAPTERS: Chapter[] = [
  { stage: 0, text: "This is Ciona intestinalis, a sea squirt. It spends its adult life fixed to a rock, filtering the water.", ms: 6000 },
  { stage: 1, text: "It did not begin this way. It began as a tiny swimming larva, with a nervous system of its own.", ms: 6000 },
  { stage: 1, text: "When the larva settles, most of those neurons disappear, and it never swims again.", ms: 5500 },
  { stage: 2, text: "In 2016, scientists mapped that nervous system cell by cell.", ms: 5000 },
  { stage: 2, text: "We gave its wiring to 80 artificial brains, showed them a market, and let natural selection do the rest.", ms: 6000 },
];

const KEY = "notochord-intro-seen";
export function introSeen() {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export default function Intro({ onStage, onDone }: { onStage: (s: 0 | 1 | 2) => void; onDone: () => void }) {
  const [at, setAt] = useState(0);
  const finish = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* Storage is optional: the intro just plays again. */
    }
    onDone();
  };
  useEffect(() => {
    if (at >= CHAPTERS.length) return;
    onStage(CHAPTERS[at].stage);
    const id = setTimeout(() => setAt(at + 1), CHAPTERS[at].ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  const final = at >= CHAPTERS.length;
  return (
    <div className="intro" onClick={() => !final && setAt(at + 1)}>
      <button className="skip" onClick={(e) => { e.stopPropagation(); finish(); }}>Skip</button>
      {final ? (
        <div className="introFinal">
          <h1>Can they learn the market?</h1>
          <p>Nobody knows yet. The first measurement says it has not been shown.</p>
          <button className="enter" onClick={finish}>Enter the laboratory</button>
        </div>
      ) : (
        <p key={at} className="introLine" aria-live="polite">{CHAPTERS[at].text}</p>
      )}
      {!final && <div className="introDots" aria-hidden="true">{CHAPTERS.map((_, i) => <span key={i} className={i <= at ? "on" : ""} />)}</div>}
    </div>
  );
}
