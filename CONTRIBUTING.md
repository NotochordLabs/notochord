# Contributing

Experiment 177 and the Lab are running on Elysium. Some files are committed to
on chain by hash; changing them breaks what anyone can verify. Please read this
before you change anything.

## Before you start and before you push

```bash
git pull --rebase            # always start from the latest main
npm run check:locks          # after committing: both lines must say OK
npm test
cd site && npx tsc --noEmit && npm run build
```

The same checks run on GitHub for every push and pull request (`.github/workflows/checks.yml`).
If `check:locks` fails, undo the change to the locked files; do not push it.

## Locked files: never edit, rename or reformat

| What | Files | Recorded on chain as |
| --- | --- | --- |
| The experiment | `src/`, `runner/`, `data/connectome/`, `protocol/`, `runner/artifacts/`, `package-lock.json` | `protocolHash` 0x00dee041…d3a7 |
| The Lab | `lab/core.ts`, `lab/runner.ts`, `lab/verify.ts`, `contracts/src/LabHabitat.sol`, `lab/RULES.md` | `rulesHash` 0xf5582faf…76dfe |

Adding or updating a dependency changes `package-lock.json`, so it is locked too.
Do not run formatters over these folders.

## Files the live site and the Lab read

| File | Read by |
| --- | --- |
| `site/public/live/config.json` | every live page |
| `site/public/live/d7f3a9c2.json` (experiment manifest) | `site/src/lib/live.ts`, `site/src/lib/lab.ts`, `lab/cli.ts` |
| `site/public/live/lab.json` (Lab manifest) | `site/src/lib/lab.ts`, `npm run lab:verify -- --manifest` |

If you rename or move one of them, update every reader in the same commit and
check the Lab page (`/lab/`) still shows the fossils.

## Deployments

- **Site:** Vercel builds `main` on every push. Whatever is on `main` is what notochord.live shows.
- **Experiment runner:** Railway builds from `main`, but only when a file in the
  runner image changes (`railway.json` → `watchPatterns`). Site and Lab changes do
  not restart it. Changes to the runner image restart the live experiment: don't.
- **Lab operator:** runs on its own server from a fixed copy of the code. Pushing
  does not change it.

## Never

- Force-push, rewrite history or delete `main`.
- Commit private keys, tokens or `.env` files.
- Change the contract addresses in `site/public/live/`.
