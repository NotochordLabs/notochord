#!/usr/bin/env python3
"""Builds data/connectome from the paper's own connectivity matrix
(Ryan, Lu & Meinertzhagen 2016, Figure 16, source data 1). Rows are presynaptic,
columns postsynaptic, values are summed synaptic depth in um.
Muscle columns and the Total row and column are left out: the brain ends at its motor neurons.
Run from the repo root."""
import csv, openpyxl
MUSCLE = {"mul", "mulm", "mur", "murm", "bm", "bm-noto"}
R = list(openpyxl.load_workbook("data/connectome/paper/fig16-data1.xlsx", data_only=True)["Sheet1"].iter_rows(values_only=True))
cols = [str(x).strip() if x is not None else None for x in R[0]]
rows = [(str(r[0]).strip(), r) for r in R[1:] if r[0] is not None and str(r[0]).strip() != "Total"]
names = [n for n, _ in rows]
names += [c for c in cols[1:] if c and c != "Total" and c not in MUSCLE and c not in names]
idx = {n: i for i, n in enumerate(names)}
edges = []
for n, r in rows:
    for j, v in enumerate(r[1:], 1):
        c = cols[j]
        if c and c != "Total" and c not in MUSCLE and isinstance(v, (int, float)) and v > 0:
            edges.append((idx[n], idx[c], round(v, 3)))
edges.sort()
with open("data/connectome/nodes.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["# index", " name"]); w.writerows(enumerate(names))
with open("data/connectome/edges.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["# source", " target", " depth"]); w.writerows(edges)
print(len(names), "cells", len(edges), "edges, self-connections", sum(a == b for a, b, _ in edges), "max depth", max(e[2] for e in edges))
