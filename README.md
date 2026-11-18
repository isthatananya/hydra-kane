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

No Kane login? `hydra demo --replay` plays a recorded run in the arena with no Kane and no LLM.

## Commands

| Command | What it does |
|---|---|
| `hydra run --seed N [--builder claude] [--bug id] [--mutator] [--escalate]` | Full loop. Exit 0 healed, 1 aborted/rejected, 2 infra/config, 3 MISS |
| `hydra replay <seed>` / `hydra demo --replay` | Replay a recorded run in the arena from the ledger and stored evidence |
| `hydra arena` / `hydra export-arena` | Live spectator view (SSE) / static export for a public URL |
| `hydra verify [--url] [--spec] [--claude-stop-hook]` | One-shot Kane check of the running app (0 pass, 1 fail, 2 infra) |
| `hydra chaos list \| seed N \| validate \| calibrate` | Inspect the bug library, prove each bug breaks the app, measure Kane's real detection |
| `hydra soak -n 10` | Run the main spec N times on the unmodified app and count flakes |
| `hydra bench --builders a,b --seeds 1,2,3` | Same seeds across builders, results table |
| `hydra stats` | Detection rate, MISS count, rounds to green, tokens per heal, holdout fail rate |
| `hydra init [--ci]` | Drop a spec, config and Claude Code Stop hook (and optionally a GitHub Action) into a repo |
| `hydra mcp` | MCP server exposing `hydra_verify` and `hydra_ledger` |

## Chaos library

Eleven pre-validated bugs. `hydra chaos validate` applies each one, builds and boots the app, and confirms with a scripted
ground-truth oracle that it breaks exactly the checks it declares. "Kane" is the expected referee outcome until
`hydra chaos calibrate` measures it; MISSes are logged, not hidden.

| Bug | Class | Seed | Breaks | Kane (hypothesis) |
|---|---|---|---|---|
| dead-pay-button | interaction | 0 | main, holdout | caught |
| pay-500 | server | 1 | main, holdout | caught |
| currency-format | display | 2 | main, holdout | unknown |
| off-by-one-qty | state | 3 | main, holdout | caught |
| fixed-coupon-ignored | coupon | 4 | holdout | missed |
| double-submit | concurrency | 6 | double-click | missed |
| wrong-total | pricing | 7 | main, holdout | caught |
| coupon-ignored | coupon | 8 | main, holdout | caught |
| stale-cart | state | 12 | main | caught |
| validation-bypass | validation | 14 | invalid-email | missed |
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
