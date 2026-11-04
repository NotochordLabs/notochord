# Notochord: Experiment 177

Can a Ciona brain learn the market?

[![specimen](https://img.shields.io/badge/specimen-Ciona_intestinalis_larva-41d3e6?style=flat-square)](https://doi.org/10.7554/eLife.16962)
[![connectome](https://img.shields.io/badge/connectome-Ryan_et_al._2016-6e8bff?style=flat-square)](https://doi.org/10.7554/eLife.16962)
[![cells](https://img.shields.io/badge/cells-216-46e08c?style=flat-square)](#the-wiring)
[![connections](https://img.shields.io/badge/connections-3%2C010-46e08c?style=flat-square)](#the-wiring)
[![chain](https://img.shields.io/badge/chain-Kinetiq_Elysium_·_running-46e08c?style=flat-square)](#status)
[![protocol](https://img.shields.io/badge/protocol-v0.2_locked-46e08c?style=flat-square)](protocol/v0.2.json)
[![result](https://img.shields.io/badge/result-market_learning_not_shown-ff5c9a?style=flat-square)](#result-so-far)
[![code](https://img.shields.io/badge/code-AGPL--3.0-111111?style=flat-square)](LICENSE)
[![data](https://img.shields.io/badge/data-CC_BY_4.0-111111?style=flat-square)](LICENSE-DATA.md)

The tadpole larva of the sea squirt *Ciona intestinalis* has 177 central neurons.
Ryan, Lu and Meinertzhagen mapped all of them from electron micrographs in 2016,
including every synapse between them.

We took that map and built brains on it. All brains share the larva's wiring.
Each one has its own genome, which sets how strong every connection is, how
easily every cell fires and whether a cell excites or inhibits. Once an hour a
brain gets HYPE price and volume, runs for 32 steps, and its left and right motor
neurons decide between sell, buy and hold.

Every 24 hours the better half of the population survives and breeds. A control
population follows the same rules, but its survivors are picked at random. After
100 generations both populations trade a period they have never seen, and a test
fixed in advance says whether selection did better than chance.

The trades are on paper. The experiment holds no funds and promises no returns.

Site: [notochord.live](https://www.notochord.live) · X: [@notochordx](https://x.com/notochordx)

## Status

Running on Elysium (chain ID 99901) since 4 November 2026 under protocol v0.2, locked at commit `48d6fbf`. Protocol hash: `0x00dee041adba5494dc69dbc09031534a0864485b6bd2263a3953279dc909d3a7`. No result yet. Contract addresses are in [`site/public/live/experiment-177.json`](site/public/live/experiment-177.json).

When the protocol is locked, the experiment will run on Kinetiq Elysium beta
mainnet: six replicates on the real wiring and six on shuffled wiring.

## Result so far

Market learning not shown.

We tested on one held-out week with six replicates. Selection against not trading
came out at p = 0.109; the threshold is p ≤ 0.016. That week had already been
looked at while we fixed a data error, so treat it as a record of the fix, not as
evidence.

Six replicates is not much. On artificial markets the test never fired by
mistake in 8 tries, found a pattern that repeats 70% of the time in 6 of 8, and
missed everything at 60% or weaker. A small real effect could slip past it.

## The wiring

The adult *Ciona* is a filter feeder stuck to a rock. The larva swims for a day or
so before it settles, and its tail is held straight by a notochord, the rod that
later became the backbone in vertebrates.

`scripts/build-connectome.py` builds the wiring from the paper's matrix (Figure
16, source data 1), without muscle targets: 216 cells, 3,010 connections. The
paper's cell table (Figure 3, source data 1) names 169 of them. We left the other
47 unnamed instead of guessing. All the cells the experiment uses for input and
output are named ones.

Our first run used a public copy of the connectome from Netzschleuder. Its row
labels are shifted, so in 192 of 205 rows the outgoing connections sit under the
wrong cell's name. We caught this on 2 November 2026, rebuilt the wiring from the
paper, ran again and withdrew the old results. Details are in
[`data/connectome/SOURCE.md`](data/connectome/SOURCE.md).

## How a brain thinks

Each hour of market data is one thought, computed with integers only.

1. Price moves go to Ant1 (rises) and Ant2 (falls), cells the paper links to
   gravity sensing. Volume compared to its 24-hour average goes to the 23
   photoreceptors. Which cells get market data is our choice; biology says
   nothing about it.
2. Every step, each cell that fired sends current to the cells it connects to,
   scaled by the genome.
3. A cell that reaches its threshold fires and resets. The rest lose a quarter
   of their potential.
4. After 32 steps we count spikes in MN1R–MN5R and MN1L–MN5L. Right ahead by more
   than two: buy. Left ahead by more than two: sell. Anything else: hold.

A genome is 3,442 bytes: a multiplier for each connection, plus a threshold and a
transmitter sign for each cell.

## Selection

| | |
| --- | --- |
| Populations | 64 selection, 16 control |
| Generation | 24 hours |
| Length | 100 generations, then 28 unseen days |
| Fitness | return minus half the deepest drawdown, 3 bps fee per position change |
| Breeding | best half survives, uniform crossover, 1% mutation |
| Control | same breeding, random survivors |
| Randomness | drand quicknet, round committed before it is published |
| Test | exact one-sided sign-flip over 6 replicates, must beat control and not trading at p ≤ 0.016 |

Brains in one population are related to each other, so they can't be counted as
independent samples. The test works across replicates instead. With six
replicates the lowest possible p is 1/64, so selection has to win in all six.

The shuffled-wiring runs are a side comparison. They are reported on their own
and do not change the main result.

## On chain

| Contract | What it stores |
| --- | --- |
| `Generation` | One replicate: steps, drand commitments, hourly decisions, fitness, survivors and offspring |
| `Specimen` | One record per brain: genome hash, parents, birth, death. Specimens have no owners |
| `Fossil` | Full genomes every 10 generations and at the end, checked against their SHA-256 |
| `ThoughtVerifier` | The brain written again in Solidity. No owner, no state |

The contracts check the order of steps, the population sizes, that the best half
survives, the parent order, that a drand round is still in the future when it is
committed, and that each fossil matches its hash.

They don't recompute decisions or fitness; the runner writes those. Anyone can
check them with the verifier, which rebuilds each replicate from its seed, drand
and Hyperliquid's public candles and stops at the first thought, score, genome or
fossil that doesn't match. For one thought per generation it also asks
`ThoughtVerifier`, through a free `eth_call` that costs 6 to 13 million gas.

## Running it

Use Node 22.23.4. Genesis and weights use floating-point functions, and their
results can differ between Node versions.

```bash
npm install
npm test
npm run sim
npm run runner:check     # read-only checks of the RPC, drand and Hyperliquid
npm run runner:replay    # rehearsal on a local chain, needs anvil
npm run runner:verify -- --manifest manifest.json
```

Writing to a live chain needs `RUNNER_PRIVATE_KEY` and `NOTOCHORD_LIVE=99901`.
The key in `runner/cli.ts` and the tests is anvil's public test key.

Contracts: `cd contracts && forge test`. Site: `cd site && npm install && npm run dev`.

## Layout

| Path | Contents |
| --- | --- |
| `src/` | The engine: brain, genome, evolution, market, statistics |
| `contracts/` | Foundry project with the four contracts |
| `runner/` | Replay, deploy, run, verify, health |
| `protocol/` | The rules as JSON |
| `data/connectome/` | The wiring and where it came from |
| `site/` | The observatory (Next.js) |
| `scripts/` | Data building, power study, diagnostics |
| `ops/` | Server setup, not tested yet |

## $CHORD

$CHORD has [a page on the site](https://www.notochord.live/chord) but no contract
address yet. Any token with that name you see today isn't ours. The token has no
say over the rules, the data or the result, and the experiment's wallet is kept
apart from every token wallet.

## Sources

Ryan K, Lu Z, Meinertzhagen IA (2016). The CNS connectome of a tadpole larva of
*Ciona intestinalis* (L.) highlights sidedness in the brain of a chordate sibling.
*eLife* 5:e16962. [doi:10.7554/eLife.16962](https://doi.org/10.7554/eLife.16962).
CC BY 4.0.

Prices from Hyperliquid's public `info` API. Randomness from drand quicknet.

## License

Code: [AGPL-3.0](LICENSE). Data: [CC BY 4.0](LICENSE-DATA.md). If you run a
modified version of this code as a public service, you have to publish your
changes too.
