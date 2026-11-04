"use client";

import { useMemo, useState } from "react";
import data from "@/data/experiment.json";

const ROLE: Record<string, string> = { priceUp: "Feels price rise", priceDown: "Feels price fall", volume: "Feels volume change", motorL: "Votes sell", motorR: "Votes buy", other: "" };
const FILTERS = [["all", "All cells"], ["used", "Input and output"], ["matched", "Matched"], ["unmatched", "Not matched"]] as const;
type Filter = (typeof FILTERS)[number][0];
type Cell = (typeof data.brain.cells)[number];

export default function CellAtlas() {
  const [filter, setFilter] = useState<Filter>("used");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const cells = data.brain.cells as Cell[];
    const into = new Int32Array(cells.length), out = new Int32Array(cells.length);
    const e = data.brain.edges as number[];
    for (let k = 0; k < e.length; k += 2) { out[e[k]]++; into[e[k + 1]]++; }
    return cells.map((c, i) => ({ ...c, into: into[i], out: out[i] }));
  }, []);
  const matched = rows.filter((r) => r.paperType).length;
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (filter === "all" || (filter === "used" && r.role !== "other") || (filter === "matched" && r.paperType) || (filter === "unmatched" && !r.paperType)) &&
    (!q || r.name.toLowerCase().includes(q) || r.paperType.toLowerCase().includes(q)));
  return (
    <article className="screen">
      <header>
        <h1>Cell atlas</h1>
        <p>Every cell in the wiring. {matched} of {rows.length} match the paper’s table by name; the rest are left unmatched rather than guessed.</p>
      </header>
      <div className="atlasBar">
        <div className="reps atlasFilters" role="group" aria-label="Filter cells">
          {FILTERS.map(([k, label]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
        <label className="atlasSearch">Search <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="MN1L, Coronet" /></label>
        <span className="dim small" aria-live="polite">{shown.length} shown</span>
      </div>
      <div className="tableWrap">
        <table className="atlasTable">
          <thead><tr><th>Cell</th><th>Type in the paper</th><th>Side</th><th className="num">Receives from</th><th className="num">Sends to</th><th>In this experiment</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className={r.paperType ? "" : "dim"}>{r.paperType || "not matched"}</td>
                <td>{r.paperSide}</td>
                <td className="num">{r.into}</td>
                <td className="num">{r.out}</td>
                <td>{ROLE[r.role]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="dim pad">No cells match. Clear the search or choose All cells.</p>}
      <p className="dim small atlasNote">Types and sides use the labels in Ryan, Lu and Meinertzhagen (2016), Figure 3, source data 1. Connections come from Figure 16, source data 1, without muscle targets. Feeding market data to these cells is our choice, not a biological claim.</p>
    </article>
  );
}
