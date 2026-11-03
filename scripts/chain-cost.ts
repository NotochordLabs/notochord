/**
 * What a deployment has really cost, read only from the chain, and what the
 * full protocol would cost at those prices. Needs no key and no local state.
 *
 *   npx tsx scripts/chain-cost.ts runner/state/test-1/manifest.json
 */
import { readFileSync } from "node:fs";
import { createPublicClient, http, toFunctionSelector, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import fossil from "../runner/artifacts/Fossil.json";
import generation from "../runner/artifacts/Generation.json";

const manifest = JSON.parse(readFileSync(process.argv[2], "utf8")) as { deployBlock: string; replicates: { generation: Address; fossil: Address }[] };
const client = createPublicClient({ transport: http((process.env.RPC_URLS ?? "https://rpc-live.boxa.club").split(",")[0]) });

const names = new Map<string, string>();
for (const abi of [generation.abi, fossil.abi] as Abi[]) {
  for (const item of abi) if (item.type === "function") names.set(toFunctionSelector(item as AbiFunction), item.name);
}

const addresses = manifest.replicates.flatMap((r) => [r.generation, r.fossil]);
const latest = await client.getBlockNumber();
const hashes = new Set<Hex>();
const STEP = 20_000n;
for (let from = BigInt(manifest.deployBlock); from <= latest; from += STEP) {
  const logs = await client.getLogs({ address: addresses, fromBlock: from, toBlock: from + STEP - 1n > latest ? latest : from + STEP - 1n });
  for (const log of logs) hashes.add(log.transactionHash);
}

const rows = new Map<string, { calls: number; gas: bigint; fee: bigint; maxFee: bigint }>();
for (const hash of hashes) {
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  const fn = tx.to ? (names.get(tx.input.slice(0, 10)) ?? "other") : "kontrat dağıtımı";
  const row = rows.get(fn) ?? { calls: 0, gas: 0n, fee: 0n, maxFee: 0n };
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  if (fee > row.maxFee) row.maxFee = fee;
  row.calls++;
  row.gas += receipt.gasUsed;
  row.fee += fee;
  rows.set(fn, row);
}

const hype = (wei: bigint | number) => (Number(wei) / 1e18).toFixed(6);
let spent = 0n;
console.log("Zincirdeki işlemler (olay yaymayan kontratlar sayılmaz; gas, veri ücretini de içerir):");
for (const [fn, r] of [...rows].sort()) {
  spent += r.fee;
  console.log(`  ${fn.padEnd(14)} ${String(r.calls).padStart(6)} işlem  ${String(r.gas / BigInt(r.calls)).padStart(11)} gas/işlem  ${hype(r.fee)} HYPE`);
}
console.log(`  toplam ${hype(spent)} HYPE`);

// Call counts from the full local rehearsal: 6 + 6 replicates, 100 generations, 28 unseen days.
const PLAN: Record<string, number> = { commitGenesis: 12, recordGenesis: 12, open: 1200, recordThought: 28800, close: 1200, record: 1320, recordHoldout: 12 };
const REHEARSAL_GAS: Record<string, bigint> = { commitGenesis: 50615n, recordGenesis: 4364011n, open: 51208n, recordThought: 53038n, close: 3256795n, record: 5843283n, recordHoldout: 123064n };
let projected = 0;
const missing: string[] = [];
for (const [fn, calls] of Object.entries(PLAN)) {
  const r = rows.get(fn);
  // The dearest call, not the mean: the last generation's close does no breeding and is far cheaper.
  if (r) projected += Number(r.maxFee) * calls;
  else {
    missing.push(fn);
    projected += Number(REHEARSAL_GAS[fn]) * calls * Number(await client.getGasPrice());
  }
}
console.log(`\nTam protokol tahmini, bu ücretlerle: ${(projected / 1e18).toFixed(3)} HYPE (kontrat dağıtımı hariç)`);
if (missing.length) console.log(`Henüz gerçek ağda görülmeyip prova gas'ıyla sayılanlar: ${missing.join(", ")}`);
console.log("Gas fiyatı değişirse bu rakam da değişir.");
