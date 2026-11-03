import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TransactionReceiptNotFoundError, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import fossilArtifact from "./artifacts/Fossil.json";
import generationArtifact from "./artifacts/Generation.json";
import type { Rules } from "./engine";
import { DRAND } from "./sources";

export interface Manifest {
  name: string;
  chainId: number;
  simulated: boolean;
  coin: string;
  seed: string;
  startMs: number;
  rules: Rules;
  protocolHash: Hex;
  replicates: { index: number; generation: Address; fossil: Address; specimen: Address; wiring?: "shuffled" }[];
  /** Block before deployment, so readers need not scan the whole chain. */
  deployBlock?: string;
  /** ThoughtVerifier: lets anyone recompute a thought on the EVM. */
  verifier?: Address;
}

/** Commits on chain to the exact simulator code and connectome the runner uses. */
export function protocolHash(): Hex {
  const h = createHash("sha256");
  const add = (dir: string, files: string[]) => {
    for (const f of files.sort()) {
      h.update(f);
      h.update(readFileSync(join(dir, f)));
    }
  };
  add("src", readdirSync("src").filter((f) => f.endsWith(".ts")));
  add("runner", readdirSync("runner").filter((f) => f.endsWith(".ts")));
  add(join("data", "connectome"), ["nodes.csv", "edges.csv"]);
  add("protocol", readdirSync("protocol").filter((f) => f.endsWith(".json")));
  return `0x${h.digest("hex")}`;
}

/**
 * Polls by hash and does not depend on new blocks appearing, which on a chain
 * that mines only on demand can never happen once the transaction is in.
 */
export async function waitForReceipt(client: PublicClient, hash: Hex, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (e) {
      if (!(e instanceof TransactionReceiptNotFoundError)) throw e;
    }
    if (Date.now() > deadline) throw new Error(`İşlem onaylanmadı: ${hash}`);
    await new Promise((r) => setTimeout(r, Math.min(client.pollingInterval, 2000)));
  }
}

export async function deployReplicates(
  publicClient: PublicClient,
  wallet: WalletClient,
  count: number,
  rules: Rules,
  genomeSize: number,
  hash: Hex,
): Promise<Manifest["replicates"]> {
  const account = wallet.account!;
  const deploy = async (abi: Abi, bytecode: string, args: unknown[]) => {
    const tx = await wallet.deployContract({ abi, bytecode: bytecode as Hex, args, account, chain: wallet.chain });
    const receipt = await waitForReceipt(publicClient, tx);
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Dağıtım başarısız: ${tx}`);
    return receipt.contractAddress;
  };
  const out: Manifest["replicates"] = [];
  for (let index = 1; index <= count; index++) {
    const generation = await deploy(generationArtifact.abi as Abi, generationArtifact.bytecode, [
      account.address,
      index,
      rules.selectionSize,
      rules.controlSize,
      rules.generations,
      rules.hoursPerGeneration,
      genomeSize,
      DRAND.genesisTime,
      DRAND.period,
      hash,
    ]);
    const fossil = await deploy(fossilArtifact.abi as Abi, fossilArtifact.bytecode, [generation]);
    const specimen = (await publicClient.readContract({
      address: generation,
      abi: generationArtifact.abi as Abi,
      functionName: "specimens",
    })) as Address;
    out.push({ index, generation, fossil, specimen });
  }
  return out;
}
