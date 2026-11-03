# Running the experiment

**Untested:** the Docker image and the systemd unit have not been run yet.

The experiment sends one transaction an hour for 100 days. When the runner stops, it picks up where it left off by reading the next step from the chain. The only persistent data is the `runner/state/` folder; keep it on a persistent disk and back it up.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `RUNNER_PRIVATE_KEY` | A wallet used only for this experiment. Never a trading wallet, never written to the repository. |
| `NOTOCHORD_LIVE=99901` | Permission to write to the real network. |
| `RPC_URLS` | Comma-separated RPC list; if the first fails, the next is tried. |
| `EXPERIMENT_NAME` | Experiment name for Docker. |
| `ALERT_WEBHOOK_URL` | Optional. `health` posts here when something goes wrong. |
| `MIN_BALANCE_HYPE` | Balance warning threshold; default 0.05. |

## Order

1. `npm run runner:check` checks every source.
2. Small test deployment: `npm run runner:deploy -- --name test-1 --replicates 1 --shuffled 0 --generations 2 --holdout 6`. This shows the real fees. The name must not be confused with the real experiment.
3. `npm run runner:run -- --name test-1`, and after 2 generations `npm run runner:verify -- --name test-1`.
4. The real experiment is deployed only after the protocol is locked.

## Downtime limit

Thoughts are filled in after the fact. The runner must be running before the start time, otherwise `commitGenesis` is rejected and the deployment is wasted. In older code a gap longer than 24 hours could kill a replicate; the current code picks a later drand round if the planned one has passed (tested with a 60-hour outage). Keep outages short anyway.

## RPC

`RPC_URLS` must relay transactions to the chain. `rpc.chainzy.io` serves reads and returns a hash, but the transaction never reached the chain (3 November 2026). Try any new endpoint with a low-fee transaction first. A single RPC is a single point of failure; add a second endpoint before the real run.

## Server

- **Docker:** `docker build -f ops/Dockerfile -t notochord-runner .`, then mount a persistent volume for `runner/state`. The volume must be writable by the `node` user.
- **systemd:** install `ops/notochord-runner.service` as `notochord-runner@<name>.service`.

## Monitoring

`npm run runner:health -- --name <name>` reads from the chain: how many hours each replicate is behind, the wallet balance, and the runner's last heartbeat. If something is wrong the exit code is 1. Run it every 15 minutes (`ops/notochord-health.timer`). The `status.json` it writes can be served to the site.

## Verification for anyone

`npm run runner:verify -- --manifest <published manifest>`. No wallet needed. It recomputes the on-chain decisions, fitness, fossils and drand values from public inputs, and sends one thought per generation to the second brain implementation on the EVM.

Version warning: genesis and connection weights use `Math.log` and `Math.cos`; different JavaScript engines can disagree in the last bit. Verify with the Node version named in the protocol.
