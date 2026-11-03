#!/usr/bin/env python3
"""Maps the cells of the wiring to Figure 3, source data 1 of Ryan et al. 2016.
Only rule-based matches are accepted; anything else stays 'unmatched'.
Run from the repo root. Writes data/connectome/cell-map.csv."""
import collections, csv, openpyxl, re
sheet = openpyxl.load_workbook("data/connectome/paper/fig3-data1.xlsx", data_only=True)["Sheet1"]
table = {}
for r in sheet.iter_rows(min_row=3, values_only=True):
    if r[0] is not None:
        table[str(r[0]).strip()] = {"type": str(r[1]).strip(), "side": str(r[3] or "").strip(), "pre": r[10], "post": r[11]}
clean = {re.sub(r"[\s*-]", "", k).lower().replace("(ep)", ""): k for k in table}
def find(name):
    n = name.lower()
    cands = [("same name", n)]
    if m := re.fullmatch(r"ant(\d)", n): cands.append(("Ant = Antenna", f"antenna{m[1]}"))
    if m := re.fullmatch(r"midtail(\d)", n): cands.append(("midtail = mt", f"mt{m[1]}"))
    if n.isdigit(): cands.append(("id = prIII id", f"priii{n}"))
    for why, c in cands:
        if c in clean: return clean[c], why
    return None, ""
names = [r[1].strip() for r in csv.reader(l for l in open("data/connectome/nodes.csv") if not l.startswith("#"))]
rows, used = [], set()
for n in names:
    k, why = find(n)
    if k: used.add(k)
    t = table.get(k, {})
    rows.append({"wiring_name": n, "paper_id": k or "", "rule": why, "paper_type": t.get("type", ""), "paper_side": t.get("side", ""), "paper_pre": t.get("pre", ""), "paper_post": t.get("post", ""), "status": "matched" if k else "unmatched"})
with open("data/connectome/cell-map.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
print("matched", sum(r["status"] == "matched" for r in rows), "of", len(rows))
print("by rule", collections.Counter(r["rule"] for r in rows if r["rule"]))
print("unmatched", [r["wiring_name"] for r in rows if r["status"] != "matched"])
print("table cells unused", [k for k in table if k not in used])
print("matched types", collections.Counter(r["paper_type"] for r in rows if r["paper_type"]))
for g, want in [("Ant", "Antenna"), ("MN", "MN"), ("pr", "PR (I)")]:
    print(g, {(r["paper_type"], r["paper_side"]) for r in rows if re.fullmatch(g + r"\d+[LR]?", r["wiring_name"])})
