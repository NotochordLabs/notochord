# The Lab: rules

The Lab is a habitat for brains bred from Experiment 177's fossils. Holders breed
them; the experiment never sees them.

## What happens

1. **Breed.** You pick two parents and burn a fixed amount of $CHORD. A parent is
   either a fossil from one of the experiment's six real-wiring replicates, or a
   Lab brain that has already been born.
2. **Birth.** The child's genes are mixed from its parents with the experiment's own
   uniform crossover and 1% mutation. The random stream is seeded by the child's id
   and the randomness of a drand quicknet round. That round is committed when you
   breed and published at 00:01 UTC of the next day, a minute after breeding for that
   day has closed, so nobody, including us, can
   know the child in advance or choose a better one.
3. **Race.** The child trades that next UTC day, 24 hours of live HYPE, on paper,
   with the experiment's own brain, senses, 3 bps fee and fitness rule
   (return minus half the deepest drawdown). The day is the same for every child
   bred the day before.
4. **Record.** Every brain is published on chain with its breeder, its parents, the
   drand round, its genome hash and its result.

## What the Lab can never do

- Write to the experiment. The Lab contract only reads fossils. The experiment's
  contracts hold no reference to the Lab, and its code and protocol hash do not
  include any Lab file.
- Hold tokens. $CHORD goes from your wallet straight to
  `0x000000000000000000000000000000000000dEaD` in the same transaction. $CHORD has
  no burn function, so total supply does not fall; the tokens are simply gone.
- Change its terms. The token, the cost, the daily cap, the operator and the fossil
  sources are fixed when the contract is deployed. The only switch is `close()`,
  which stops new breeding for good; children already bred are still born and raced.
- Pay prizes. There are none.

## What is trusted, and how to check it

Births and results are written by the Lab operator, from its own wallet, which is
separate from the experiment's. The contract enforces that a birth cannot be
recorded before its drand round is out, and a result not before its day has closed.
It does not recompute genomes or races. Anyone can:

```bash
npm run lab:verify
```

which rebuilds every child from the parents and drand, every race from Hyperliquid's
public candles, and compares each with the chain.

## Numbers

| | |
| --- | --- |
| Cost per breeding | 10,000 $CHORD, fixed at deploy (`breedCost`) |
| Children per day | at most 200, fixed at deploy (`maxPerDay`) |
| Race | one UTC day, 24 hourly decisions, starting the day after breeding |
| Result | posted after the day's last candle closes, from 01:00 UTC |
| Mutation | 1% per gene, as in the experiment |

If the operator stops, bred children stay as they are: the burn cannot be undone,
and nothing else is at stake.
