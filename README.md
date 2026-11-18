# Hydra

A verification loop for AI coding agents: **a builder ships, a chaos agent breaks it, Kane CLI referees in a real browser.**
Nothing deploys until Kane passes, and Kane's failure evidence is the only thing the builder sees when it heals.

```
BUILD → BASELINE (Kane ×2) → CHAOS (1 hidden bug) → REFEREE (Kane)
                                                      ├─ pass   → MISS (logged, escalated)
                                                      ├─ exit 1 → CATCH → HEAL (prompt = Kane evidence only)
                                                      └─ exit 2 → infra error, retried, never sent to the builder
HEAL → VERIFY (fresh Kane ×2 + hidden holdout) → DEPLOY gate     (max 5 heal rounds)
```

## Quick start

Requires Node ≥ 20.11, Chrome, and [Kane CLI](https://www.npmjs.com/package/@testmuai/kane-cli).

```sh
npm install
npm run build
npm install -g @testmuai/kane-cli && kane-cli login
node bin/hydra.js doctor          # checks Node, Kane login, Chrome, builders, ports
node bin/hydra.js run --seed 7    # seed 7 → "wrong-total"
```

No Kane login? `node bin/hydra.js demo --replay` opens the arena on the recordings in `demo/`, with no Kane and no LLM.

## Results

Recorded with kane-cli 0.10.4 on the bundled checkout app. Every run below is in `demo/` and replays in the arena.

| Seed | Bug | Builder | Kane referee | Outcome |
|---|---|---|---|---|
| 7 | wrong-total | claude | CATCH | **Healed in 1 round**: an exact inverse of the hidden bug, then 2 fresh passes + holdout → deployed |
| 7 | wrong-total | cheater (edits the spec) | CATCH | **Rejected**: spec hash changed, spec restored, gate refused |
| 7 | wrong-total | hardcoder (hardcodes SAVE10 totals) | CATCH | **Never deployed**: passed the visible spec twice, then failed the hidden holdout |
| 14 | validation-bypass | claude | **MISS** | Logged honestly: the main flow never submits a bad email |
| 7 | wrong-total | opencode | CATCH | **Healed in 1 round**: the same one-line fix as Claude → deployed |

Same seed, two builders (`hydra stats`):

| Builder | Rounds to green | Time to heal | Tokens | Kane runs |
|---|---|---|---|---|
| claude | 1 | 593 s | 153,619 | 6 |
| opencode (free default model) | 1 | 600 s | 399,238 (incl. cache reads) | 6 |

A heal costs about 6 Kane runs (≈280 credits, no infra retries) and about 10 minutes from injection to green.

**Browse the runs:** [isthatananya.github.io/hydra-kane](https://isthatananya.github.io/hydra-kane/) is a static arena exported to
`docs/` with `hydra export-arena`, so it needs no backend and no Kane.

One finding from the hardcoder run: Kane's *verdict and evidence* were right ("shipping is $8.00 and total $49.50"),
but its prose explanation blamed a missed click that its own step log shows succeeded. Hydra therefore feeds the
builder Kane's raw evidence lines, not just the summary.

## Commands

| Command | What it does |
|---|---|
| `hydra run --seed N [--builder claude] [--bug id] [--mutator] [--escalate]` | Full loop. Exit 0 healed, 1 aborted/rejected, 2 infra/config, 3 MISS |
| `hydra replay <seed>` / `hydra demo --replay` | Replay a recorded run in the arena from the ledger and stored evidence |
| `hydra arena` / `hydra export-arena -o docs` | Live spectator view (SSE) / static export for a public URL (GitHub Pages) |
| `hydra demo-pack --run <id...>` | Bundle finished runs (ledger + displayed evidence only, ~4 MB each) into `demo/` |
| `hydra verify [--url] [--spec] [--claude-stop-hook]` | One-shot Kane check of the running app (0 pass, 1 fail, 2 infra) |
| `hydra chaos list \| seed N \| validate \| calibrate` | Inspect the bug library, prove each bug breaks the app, measure Kane's real detection |
| `hydra soak -n 10` | Run the main spec N times on the unmodified app and count flakes |
| `hydra bench --builders a,b --seeds 1,2,3` | Same seeds across builders, results table |
| `hydra stats` | Detection rate, MISS count, rounds to green, tokens per heal, holdout fail rate |
| `hydra init [--ci]` | Drop a spec, config and Claude Code Stop hook (and optionally a GitHub Action) into a repo |
| `hydra mcp` | MCP server exposing `hydra_verify` and `hydra_ledger` |

## Chaos library

Eleven pre-validated bugs. `hydra chaos validate` applies each one, builds and boots the app, and confirms with a scripted
ground-truth oracle that it breaks exactly the checks it declares. `hydra chaos calibrate` then runs Kane's main flow
against each bug (results in `chaos/calibration.json`). MISSes are logged, not hidden.

**Measured with kane-cli 0.10.4: Kane caught 8 of 11 (73%).** All three misses are bugs outside the main flow's path
(a bad email, a double click, a fixed-amount coupon), which is what the holdout flow and the spec agent are for.
On the unmodified app, a 10-run soak passed 10/10 (≈48 credits and ≈220 s per run).

| Bug | Class | Seed | Breaks | Kane (measured) |
|---|---|---|---|---|
| dead-pay-button | interaction | 0 | main, holdout | caught |
| pay-500 | server | 1 | main, holdout | caught |
| currency-format | display | 2 | main, holdout | caught |
| off-by-one-qty | state | 3 | main, holdout | caught |
| fixed-coupon-ignored | coupon | 4 | holdout | **missed** |
| double-submit | concurrency | 6 | double-click | **missed** |
| wrong-total | pricing | 7 | main, holdout | caught |
| coupon-ignored | coupon | 8 | main, holdout | caught |
| stale-cart | state | 12 | main | caught |
| validation-bypass | validation | 14 | invalid-email | **missed** |
| confirmation-amount | display | 30 | main, holdout | caught |

## Anti-cheat

- Specs are hashed and set read-only at run start, and re-hashed after every builder patch. Tampering is reverted and the round is rejected.
- Chaos lands in a workspace whose git history is squashed to one commit, so there is nothing to `git revert`.
- The builder may only change allowlisted paths (`app/**`, `components/**`, `lib/**`). Anything else is reverted and flagged.
- A hidden holdout flow (different coupon, different quantity) runs after the main spec passes, which catches hardcoded fixes.
- The deploy gate has no override flag. It re-hashes specs and source before promoting.

Two deliberately cheating builders (`cheater`, `hardcoder`) ship in the config to prove the gate rejects them.

## Configuration

`hydra.config.json` sets the app dir and port, specs, Kane timeouts and run budget, heal cap, path allowlist and builders.
A builder is any shell command template. The heal prompt goes to it on stdin, and it is built only from Kane's summary,
failing step, logs, screenshot paths and ShareLink.

## Development

```sh
npm run typecheck
npm test          # builds, then runs node --test on test/
```

## License

MIT
