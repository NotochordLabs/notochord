# Notochord contracts

A Foundry project. Not deployed to any network yet.

| Contract | Role |
| --- | --- |
| `Generation` | Records one replicate: step order, drand commitment, decisions, fitness, selection and offspring |
| `Specimen` | A record per specimen (genome hash, parents, birth, elimination); created by `Generation`. No ownership |
| `Fossil` | Stores full genomes every 10 generations and at the last generation, checked against their hash |

## What does the contract guarantee?

Enforced on chain: step order, population sizes, that selection keeps the better half, parent order, that the drand round is in the future when it is committed, and that each fossil genome matches its recorded SHA-256.

Still trusted to the runner (anyone can check it off chain with the open simulator): fitness values, decisions, genome hashes, the drand value itself, and who is eliminated in the control group. The Verifier that will check these on chain is in phase 2.

Each deployment is one replicate. The protocol's statistics need at least 6 replicates, so 6 separate `Generation` + `Fossil` deployments.

## Running

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # once
cd contracts
forge test
```

`test/fixtures/r1-gen0-10.json` holds the first 10 generations of the simulator's replicate 1. To regenerate it, from the project root with the fossils present: `npx tsx scripts/export-chain-fixture.ts`.

`lib/` contains copies of forge-std and OpenZeppelin Contracts 5.6.1.
