import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConnectome, syntheticConnectome } from "./connectome";
import { DEFAULTS, runExperiment, type Config, type Result } from "./experiment";
import { loadMarket, syntheticMarket } from "./market";
import { ALPHA, signFlipTest } from "./stats";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, fallback: number) => (arg(name) !== undefined ? Number(arg(name)) : fallback);

const synthetic = flag("synthetic");
const coin = arg("coin") ?? "HYPE";
const seed = arg("seed") ?? (synthetic ? "synthetic-001" : "experiment-177-001");
const replicates = num("replicates", 6);
const outRoot = arg("out") ?? join("out", seed);
const base: Omit<Config, "seed" | "outDir"> = {
  ...DEFAULTS,
  generations: num("generations", DEFAULTS.generations),
  popSize: num("pop", DEFAULTS.popSize),
  controlSize: num("control", DEFAULTS.controlSize),
  mutationRate: num("mutation", DEFAULTS.mutationRate),
};

const connectome = synthetic ? syntheticConnectome() : loadConnectome(join("data", "connectome"));
const market = synthetic
  ? syntheticMarket(base.generations * base.hoursPerGeneration + base.holdoutHours + 48)
  : loadMarket(join("data", `prices-${coin}-1h.json`));

const line = "─".repeat(78);
const pad = (x: number, w = 6) => String(x).padStart(w);
console.log(line);
console.log("NOTOCHORD · Experiment 177");
if (connectome.synthetic || market.synthetic) {
  console.log("!! SYNTHETIC DATA: this run only tests the code, its results mean nothing. !!");
}
console.log(`Brain  : ${connectome.source} · ${connectome.n} cells, ${connectome.edgeSrc.length} connections`);
console.log(`Market : ${market.source} · ${market.candles.length} hours`);
console.log(
  `Design : ${replicates} independent replicates × ${base.generations} generations · ${base.popSize} selection + ${base.controlSize} control · seed "${seed}"`,
);
console.log(line);

const t0 = Date.now();
const results: Result[] = [];
for (let k = 1; k <= replicates; k++) {
  const cfg: Config = { ...base, seed: `${seed}/r${k}`, outDir: join(outRoot, `r${k}`) };
  const verbose = k === 1;
  if (verbose) console.log(`Replicate 1 in detail (the others as a summary):`);
  const r = runExperiment(connectome, market, cfg, (g) => {
    if (verbose && (g.generation % 10 === 0 || g.generation === base.generations - 1)) {
      console.log(
        `  Gen ${pad(g.generation, 3)} | ${g.windowStart.slice(0, 10)} | selection mean ${pad(g.selection.mean)} · best ${pad(g.selection.best)}` +
          ` | control mean ${pad(g.control.mean)} | market ${pad(g.buyHold)} | fired ${g.selection.firedMean}`,
      );
    }
  });
  mkdirSync(cfg.outDir!, { recursive: true });
  writeFileSync(join(cfg.outDir!, "results.json"), JSON.stringify(r, null, 2));
  results.push(r);
  console.log(
    `Replicate ${k}: training difference ${pad(r.training.meanDiffBps)} bps/day · unseen week selection ${pad(r.holdout.selectionMean)}` +
      ` / control ${pad(r.holdout.controlMean)} bps`,
  );
}

const roles = results[0].roles;
console.log(line);
console.log(`Role mapping (price: ${roles.method.price}, volume: ${roles.method.volume}, motor: ${roles.method.motor})`);
console.log(`  price ↑  : ${roles.priceUp.join(", ")}`);
console.log(`  price ↓  : ${roles.priceDown.join(", ")}`);
console.log(`  volume   : ${roles.volume.join(", ")}`);
console.log(`  motor L  : ${roles.motorL.join(", ")}`);
console.log(`  motor R  : ${roles.motorR.join(", ")}`);
if (Object.values(roles.method).includes("degree")) {
  console.log("  Note: 'degree' = cell names were not recognised, picked by network structure. Check against the names in the paper (roles.ts).");
}

const trainDiffs = results.map((r) => r.training.meanDiffBps);
const holdDiffs = results.map((r) => r.holdout.selectionMean - r.holdout.controlMean);
const holdAbs = results.map((r) => r.holdout.selectionMean);
const train = signFlipTest(trainDiffs);
const hold = signFlipTest(holdDiffs);
const flat = signFlipTest(holdAbs);
const last = results.map((r) => r.generations[r.generations.length - 1]);
const d = results[0].data;
const pos = (xs: number[]) => `${xs.filter((x) => x > 0).length}/${replicates} replicates positive`;
console.log(line);
console.log(`1) Does evolution work? Training (${d.trainFrom.slice(0, 10)} → ${d.holdoutFrom.slice(0, 10)})`);
console.log(`   selection − control: mean ${Math.round(train.observed)} bps/day, ${pos(trainDiffs)}, p = ${train.p.toFixed(4)}`);
console.log(
  `   daily trades in the last generation: selection ${(last.reduce((a, g) => a + g.selection.tradesMean, 0) / replicates).toFixed(1)}` +
    `, control ${(last.reduce((a, g) => a + g.control.tradesMean, 0) / replicates).toFixed(1)}` +
    ` · time in position: selection ${Math.round((100 * last.reduce((a, g) => a + g.selection.exposure, 0)) / replicates)}%` +
    `, control ${Math.round((100 * last.reduce((a, g) => a + g.control.exposure, 0)) / replicates)}%`,
);
console.log(`2) Did it learn the market? Unseen week (${d.holdoutFrom.slice(0, 10)} → ${d.holdoutTo.slice(0, 10)})`);
console.log(`   selection − control     : mean ${Math.round(hold.observed)} bps, ${pos(holdDiffs)}, p = ${hold.p.toFixed(4)}`);
console.log(`   selection − not trading : mean ${Math.round(flat.observed)} bps, ${pos(holdAbs)}, p = ${flat.p.toFixed(4)}`);
console.log(`   (context: buy-and-hold over the same week ${results[0].holdout.buyHold} bps)`);
const minP = 1 / 2 ** replicates;
if (minP > ALPHA) console.log(`   Note: the smallest p reachable with ${replicates} replicates is ${minP.toFixed(3)}; p ≤ ${ALPHA} needs at least 6 replicates.`);

const evolves = train.p <= ALPHA;
const learns = hold.p <= ALPHA && flat.p <= ALPHA;
console.log(line);
console.log(
  learns
    ? "Result: H0 rejected. On the unseen week, selection significantly beat both control and not trading."
    : evolves
      ? "Result: evolution works, but market learning was not shown (most likely it learned to avoid costs and risk)."
      : "Result: H0 not rejected. No significant difference between selection and control was shown.",
);

writeFileSync(
  join(outRoot, "summary.json"),
  JSON.stringify(
    {
      seed,
      replicates,
      config: base,
      data: d,
      roles,
      training: { diffsBps: trainDiffs, meanBps: train.observed, p: train.p },
      holdout: {
        vsControl: { diffsBps: holdDiffs, meanBps: hold.observed, p: hold.p },
        vsFlat: { selectionBps: holdAbs, meanBps: flat.observed, p: flat.p },
        buyHold: results[0].holdout.buyHold,
      },
      evolves,
      rejectH0: learns,
    },
    null,
    2,
  ),
);
console.log(`Time ${((Date.now() - t0) / 1000).toFixed(0)} s · output: ${outRoot}/summary.json and r1..r${replicates}/`);
