#!/bin/bash
# Resumable: skips finished replicates. Finishes every strength of a market before the next.
cd "$(dirname "$0")/.."; OUT=out/power/results.jsonl; touch $OUT
for mk in $(seq 1 ${1:-8}); do for pct in 50 55 60 70; do for r in $(seq 1 18); do
  grep -q "\"pct\":$pct,\"mk\":$mk,\"rep\":$r," $OUT || echo "$pct $mk $r $OUT"
done; done; done | xargs -P 2 -L 1 npx tsx scripts/power-run.ts
