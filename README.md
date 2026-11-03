# Notochord: Experiment 177

**Can a Ciona brain learn the market?**

Artificial brains carrying the mapped wiring of a *Ciona intestinalis* larva evolve by natural selection against hourly HYPE prices. The experiment is designed to run in public on Kinetiq Elysium beta mainnet.

**Status: not deployed. Protocol v0.2 is a draft and is not locked.** Nothing here has run on a live chain yet. Everything the site shows today is labelled as a simulation.

Site: [notochord.live](https://www.notochord.live). X: [@notochordx](https://x.com/notochordx).

The experiment manages no funds. Trades are on paper, and it promises no returns.

## Result so far

Market learning not shown. On one week of held-out data, with six replicates, selection against not trading gave p = 0.109 against a threshold of p ≤ 0.016. That week had already been seen during a data correction, so this is a correction record, not evidence.

A power study on artificial markets found no false alarms in 8 markets. The test caught a 70% repeat pattern in 6 of 8 markets and missed 60% and below in all 8 at this replicate count. A "not shown" result does not rule out a small effect.

## How it works

- **Wiring:** 216 cells and 3010 connections from the matrix in Ryan et al. (2016). Muscle targets are excluded.
- **Genome:** 3442 bytes: a multiplier per connection, plus a threshold and transmitter sign per cell.
- **Brain:** integer-only leaky integrate-and-fire, 32 steps per thought, one thought per hour.
- **Senses:** Ant1 and Ant2 receive price direction, pr1–23 receive volume. Giving market data to these cells is our choice, not biology.
- **Decision:** the left and right motor neurons MN1–5 decide sell or buy.
- **Selection:** 64 specimens, 24-hour generations, 100 generations. The better half survives and breeds, with 1% mutation. A control group of 16 follows the same rules, but chance picks who dies.
- **Fitness:** return minus half the maximum drawdown, with a 3 bps fee on position changes.
- **Test:** exact one-sided sign-flip across 6 independent replicates. On 28 unseen days, selection must beat both control and not trading at p ≤ 0.016.
- **Secondary, exploratory:** 6 replicates on degree-preserving shuffled wiring.

The rules are in [`protocol/v0.2.json`](protocol/v0.2.json).

## Run it

Use Node 22.23.4: genesis and weights use floating-point math functions, so results are only reproducible on the pinned version.

```bash
npm install
npm test
npm run sim
npm run runner:check     # read-only checks of the RPC, drand and Hyperliquid
npm run runner:replay    # local chain rehearsal; needs anvil. Simulated, not a result
```

Live writes need both `RUNNER_PRIVATE_KEY` and `NOTOCHORD_LIVE=99901`. The key in `runner/cli.ts` and the tests is anvil's public test key.

For the site: `cd site && npm install && npm run dev`.

## Layout

| Path | Contents |
| --- | --- |
| `src/` | Deterministic engine: brain, genome, evolution, market, statistics |
| `contracts/` | Foundry: Specimen, Generation, Fossil, ThoughtVerifier |
| `runner/` | Replay, deploy, run, verify, health |
| `site/` | Next.js observatory |
| `data/connectome/` | Wiring built from the paper, with [`SOURCE.md`](data/connectome/SOURCE.md) |
| `scripts/` | Data building, power study, diagnostics |
| `ops/` | Server package, not yet tested |

## Sources

Ryan K, Lu Z, Meinertzhagen IA (2016). The CNS connectome of a tadpole larva of *Ciona intestinalis* (L.) highlights sidedness in the brain of a chordate sibling. eLife 5:e16962. [doi:10.7554/eLife.16962](https://doi.org/10.7554/eLife.16962). CC BY 4.0.

Prices: Hyperliquid public `info` API. Randomness: drand quicknet.
