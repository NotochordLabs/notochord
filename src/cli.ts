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
console.log("NOTOCHORD · Deney 177");
if (connectome.synthetic || market.synthetic) {
  console.log("!! SENTETİK VERİ: Bu çalıştırma sadece kodu test eder, sonuçları anlamsızdır. !!");
}
console.log(`Beyin  : ${connectome.source} · ${connectome.n} hücre, ${connectome.edgeSrc.length} bağlantı`);
console.log(`Piyasa : ${market.source} · ${market.candles.length} saat`);
console.log(
  `Düzen  : ${replicates} bağımsız tekrar × ${base.generations} nesil · ${base.popSize} seçilim + ${base.controlSize} kontrol · tohum "${seed}"`,
);
console.log(line);

const t0 = Date.now();
const results: Result[] = [];
for (let k = 1; k <= replicates; k++) {
  const cfg: Config = { ...base, seed: `${seed}/r${k}`, outDir: join(outRoot, `r${k}`) };
  const verbose = k === 1;
  if (verbose) console.log(`Tekrar 1 ayrıntılı (diğerleri sadece özet):`);
  const r = runExperiment(connectome, market, cfg, (g) => {
    if (verbose && (g.generation % 10 === 0 || g.generation === base.generations - 1)) {
      console.log(
        `  Nesil ${pad(g.generation, 3)} | ${g.windowStart.slice(0, 10)} | seçilim ort ${pad(g.selection.mean)} · en iyi ${pad(g.selection.best)}` +
          ` | kontrol ort ${pad(g.control.mean)} | piyasa ${pad(g.buyHold)} | ateşlenen ${g.selection.firedMean}`,
      );
    }
  });
  mkdirSync(cfg.outDir!, { recursive: true });
  writeFileSync(join(cfg.outDir!, "results.json"), JSON.stringify(r, null, 2));
  results.push(r);
  console.log(
    `Tekrar ${k}: eğitim farkı ${pad(r.training.meanDiffBps)} bps/gün · görülmemiş hafta seçilim ${pad(r.holdout.selectionMean)}` +
      ` / kontrol ${pad(r.holdout.controlMean)} bps`,
  );
}

const roles = results[0].roles;
console.log(line);
console.log(`Rol eşlemesi (fiyat: ${roles.method.price}, hacim: ${roles.method.volume}, motor: ${roles.method.motor})`);
console.log(`  fiyat ↑  : ${roles.priceUp.join(", ")}`);
console.log(`  fiyat ↓  : ${roles.priceDown.join(", ")}`);
console.log(`  hacim    : ${roles.volume.join(", ")}`);
console.log(`  motor sol: ${roles.motorL.join(", ")}`);
console.log(`  motor sağ: ${roles.motorR.join(", ")}`);
if (Object.values(roles.method).includes("degree")) {
  console.log("  Not: 'degree' = hücre adları tanınamadı, ağ yapısına göre seçildi. Makaledeki adlarla doğrula (roles.ts).");
}

const trainDiffs = results.map((r) => r.training.meanDiffBps);
const holdDiffs = results.map((r) => r.holdout.selectionMean - r.holdout.controlMean);
const holdAbs = results.map((r) => r.holdout.selectionMean);
const train = signFlipTest(trainDiffs);
const hold = signFlipTest(holdDiffs);
const flat = signFlipTest(holdAbs);
const last = results.map((r) => r.generations[r.generations.length - 1]);
const d = results[0].data;
const pos = (xs: number[]) => `${xs.filter((x) => x > 0).length}/${replicates} tekrarda pozitif`;
console.log(line);
console.log(`1) Evrim işliyor mu? Eğitim (${d.trainFrom.slice(0, 10)} → ${d.holdoutFrom.slice(0, 10)})`);
console.log(`   seçilim − kontrol: ort. ${Math.round(train.observed)} bps/gün, ${pos(trainDiffs)}, p = ${train.p.toFixed(4)}`);
console.log(
  `   son nesilde günlük işlem: seçilim ${(last.reduce((a, g) => a + g.selection.tradesMean, 0) / replicates).toFixed(1)}` +
    `, kontrol ${(last.reduce((a, g) => a + g.control.tradesMean, 0) / replicates).toFixed(1)}` +
    ` · pozisyonda geçen süre: seçilim %${Math.round((100 * last.reduce((a, g) => a + g.selection.exposure, 0)) / replicates)}` +
    `, kontrol %${Math.round((100 * last.reduce((a, g) => a + g.control.exposure, 0)) / replicates)}`,
);
console.log(`2) Piyasayı öğrendi mi? Görülmemiş hafta (${d.holdoutFrom.slice(0, 10)} → ${d.holdoutTo.slice(0, 10)})`);
console.log(`   seçilim − kontrol    : ort. ${Math.round(hold.observed)} bps, ${pos(holdDiffs)}, p = ${hold.p.toFixed(4)}`);
console.log(`   seçilim − hiç işlem  : ort. ${Math.round(flat.observed)} bps, ${pos(holdAbs)}, p = ${flat.p.toFixed(4)}`);
console.log(`   (bağlam: aynı hafta al-tut ${results[0].holdout.buyHold} bps)`);
const minP = 1 / 2 ** replicates;
if (minP > ALPHA) console.log(`   Not: ${replicates} tekrarla ulaşılabilecek en küçük p = ${minP.toFixed(3)}; p ≤ ${ALPHA} için en az 6 tekrar gerekir.`);

const evolves = train.p <= ALPHA;
const learns = hold.p <= ALPHA && flat.p <= ALPHA;
console.log(line);
console.log(
  learns
    ? "Sonuç: H0 reddedildi. Seçilim, görülmemiş haftada hem kontrolü hem hiç işlem yapmamayı anlamlı ölçüde geçti."
    : evolves
      ? "Sonuç: Evrim işliyor ama piyasayı öğrendiği gösterilemedi (büyük olasılıkla maliyet ve riskten kaçınmayı öğrendi)."
      : "Sonuç: H0 reddedilemedi. Seçilim ile kontrol arasında anlamlı fark gösterilemedi.",
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
console.log(`Süre ${((Date.now() - t0) / 1000).toFixed(0)} sn · çıktı: ${outRoot}/summary.json ve r1..r${replicates}/`);
