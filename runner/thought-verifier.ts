import type { Abi, Address, Hex, PublicClient, WalletClient } from "viem";
import artifact from "./artifacts/ThoughtVerifier.json";
import { waitForReceipt } from "./deploy";
import type { Lab } from "./engine";
import type { Senses } from "../src/brain";

const ABI = artifact.abi as Abi;

/** The wiring in the byte layout ThoughtVerifier.sol reads. */
export function wiringBytes(lab: Lab): Hex {
  const { connectome: c, roles: r } = lab;
  const row = Buffer.alloc((c.n + 1) * 2);
  c.rowPtr.forEach((v, i) => row.writeUInt16BE(v, i * 2));
  const lists = [r.priceUp, r.priceDown, r.volume, r.motorL, r.motorR];
  return `0x${Buffer.concat([row, Buffer.from(c.edgeDst), Buffer.from(c.edgeSrc), Buffer.from(c.edgeBase), Buffer.from(lists.map((l) => l.length)), Buffer.from(lists.flat())]).toString("hex")}`;
}

export async function deployThoughtVerifier(client: PublicClient, wallet: WalletClient, lab: Lab): Promise<Address> {
  const hash = await wallet.deployContract({
    abi: ABI,
    bytecode: artifact.bytecode.object as Hex,
    args: [BigInt(lab.connectome.n), BigInt(lab.connectome.edgeSrc.length), wiringBytes(lab)],
    account: wallet.account!,
    chain: wallet.chain,
  });
  const receipt = await waitForReceipt(client, hash);
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`ThoughtVerifier could not be deployed: ${hash}`);
  return receipt.contractAddress;
}

/** A free eth_call: the EVM brain, not the TypeScript one, gives this answer. */
export async function thinkOnChain(client: PublicClient, address: Address, genome: Uint8Array, s: Senses) {
  const out = (await client.readContract({ address, abi: ABI, functionName: "think", args: [`0x${Buffer.from(genome).toString("hex")}`, s.r1, s.r4, s.dv] })) as { decision: number; fired: number; motorL: number; motorR: number; genomeHash: Hex };
  return { decision: Number(out.decision), fired: Number(out.fired), genomeHash: out.genomeHash };
}
