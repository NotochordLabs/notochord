# Notochord site

The Experiment 177 laboratory: Observatory, Population, Genome, Lineage, Fossils, Ledger and Protocol. A static site with no wallet.

```bash
cd site
npm install
npm run dev     # http://localhost:3000
```

Data lives in `public/archive/` and `src/data/experiment.json`. After a new simulator run, from the project root:

```bash
npx tsx scripts/export-archive.ts <seed>
npx tsx scripts/export-site-data.ts <seed>
```

`src/lib/brain.ts` is generated from `src/brain.ts`, so the browser runs the simulator's own engine. The Observatory recomputes each specimen's return and fitness and compares them with the archive.

The site shows a simulation preview until it is connected to the on-chain experiment. Update the rail note and the Ledger when that happens.
