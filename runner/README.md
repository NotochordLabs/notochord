# Notochord runner

Connects the simulator to the contracts. It reads from the chain which step comes next, so it can stop and start again; each `step` sends at most one transaction.

| Command | What it does | Network |
| --- | --- | --- |
| `npm run runner:replay` | Plays the full experiment on a temporary local chain with historical data and a fake drand; its results are not experiment results | Local only (needs Foundry's `anvil`) |
| `npm run runner:check` | Reads RPC, drand and Hyperliquid access | Read |
| `npm run runner:deploy -- --name X` | Deploys the 6 replicates | Real network, spends money |
| `npm run runner:run -- --name X` | Live loop | Real network, spends money |
| `npm run runner:status -- --name X` | Reads results from the chain | Read |

Writing to the real network needs two environment variables together: `RUNNER_PRIVATE_KEY` and `NOTOCHORD_LIVE=99901`. Never put the key in a file or a chat. RPC endpoints go in `RPC_URLS`, comma-separated; if one does not answer, the next is used.

`runner/state/` holds genomes that cannot be regenerated. During a live run it must not be deleted, and it must be backed up.

If the contracts change, `runner/artifacts/` must be rebuilt.
