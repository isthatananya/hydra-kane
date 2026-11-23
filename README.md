# Hydra

**A proving ground for AI coding agents.** A builder ships an app, a chaos agent secretly breaks it, and
[Kane CLI](https://www.npmjs.com/package/@testmuai/kane-cli) referees in a real browser. Nothing deploys until Kane
passes, and Kane's failure evidence is the only thing the builder sees when it heals.

**Live:** [Find the bug before Kane](https://hydra-kane.vercel.app/play.html) (three live shops, one hidden bug each) ·
[Leaderboard](https://hydra-kane.vercel.app/board.html) · [Every run, replayable](https://hydra-kane.vercel.app/)

Because Hydra plants the bug itself, it knows the answer key. That lets it score both sides, which a test run on
its own cannot:

- **Kane:** what it caught and what it missed. Measured: **9 of 12** chaos bugs caught, and every miss explained.
- **The coding agents:** who heals, in how many rounds, at what token and Kane-credit cost. Two of the builders are
  built to cheat (one edits Kane's test, one hardcodes the expected totals), and both are caught.

```
BUILD → BASELINE (Kane ×2) → CHAOS (1 hidden bug) → REFEREE (Kane, confirmed by a 2nd run; a 3rd breaks a tie)
                                                      ├─ pass   → MISS (logged, escalated)
                                                      ├─ exit 1 → CATCH → HEAL (prompt = Kane evidence only)
                                                      └─ exit 2 → infra error, retried, never sent to the builder
HEAL → VERIFY (fresh Kane ×2 + hidden holdout) → DEPLOY gate     (max 5 heal rounds)
```

## For judges

| Criterion | Where to check it |
|---|---|
| Try it in 30 seconds | [Find the bug before Kane](https://hydra-kane.vercel.app/play.html): the same bugs Hydra plants, live, scored against Kane's real recorded verdicts and times |
| Works end to end | Six recorded runs with real Kane CLI and real Claude Code / opencode, each a [replayable match report](https://hydra-kane.vercel.app/). Locally: `node bin/hydra.js run --seed 7` |
| Kane caught something | [Kane catches the wrong-total bug](https://hydra-kane.vercel.app/?run=20261119-003757-s7-claude#moment=catch), then [a state bug](https://hydra-kane.vercel.app/?run=20261119-140125-s12-claude#moment=catch) only visible after a remove click |
| Kane and the agent talk | The heal prompt is built only from Kane's evidence: summary, failing step, screenshots, logs, ShareLink ([adapter.ts](src/builder/adapter.ts)). A test proves it never leaks the bug, its diff or the hidden holdout ([loop-parts.test.mjs](test/loop-parts.test.mjs)) |
| Closed loop, verified | A fix ships only after 2 fresh Kane passes, a hidden holdout and a gate that re-hashes specs and source: [the proof](https://hydra-kane.vercel.app/?run=20261119-140125-s12-claude#moment=proof) |
| The agent cannot cheat | [The cheater edits Kane's test: rejected](https://hydra-kane.vercel.app/?run=20261119-010607-s7-cheater#moment=cheat). [The hardcoder fools the visible test twice, fails the hidden holdout](https://hydra-kane.vercel.app/?run=20261119-014645-s7-hardcoder#moment=gate) |
| Honest about Kane | [Kane's catch map](https://hydra-kane.vercel.app/board.html): 3 misses out of 12, each explained. [A recorded miss](https://hydra-kane.vercel.app/?run=20261119-013112-s14-claude#moment=miss), logged instead of hidden |
| Tested without credits | `npm test` (25 tests) and `npm run test:loop`: the whole loop with real builds and a stand-in referee, run in [CI](.github/workflows/ci.yml) on every push |

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
| 12 | stale-cart (state) | claude | CATCH | **Healed in 1 round**: put back the immutable `filter` in place of the in-place `splice` → deployed |

Same seed, two builders (`hydra stats`):

| Builder | Rounds to green | Time to heal | Tokens | Kane runs |
|---|---|---|---|---|
| claude | 1 | 593 s | 153,619 | 6 |
| opencode (free default model) | 1 | 600 s | 399,238 (incl. cache reads) | 6 |

A heal costs about 6 Kane runs (≈280 credits, no infra retries) and about 10 minutes from injection to green.

**Browse the runs:** [hydra-kane.vercel.app](https://hydra-kane.vercel.app/) (mirror: [GitHub Pages](https://isthatananya.github.io/hydra-kane/docs/)) is a static arena exported to
`docs/` with `hydra export-arena`, so it needs no backend and no Kane.

### Math bugs vs state bugs

A wrong number for given inputs and a number that goes wrong only after an input changes fail differently,
so every chaos bug is tagged with how it surfaces (`hydra chaos list`, `hydra stats` reports detection per surface):

| Surface | What breaks | Bugs | What a verifier must do |
|---|---|---|---|
| **math** | wrong value for the given inputs | wrong-total, coupon-ignored, fixed-coupon-ignored, currency-format, confirmation-amount | reach the inputs, then read the value |
| **state** | right until an input changes (qty, remove, coupon), then stale or wrong | stale-cart, off-by-one-qty, stale-quote-on-qty | click through the change, then check again |
| **flow** | an action or request path breaks | dead-pay-button, validation-bypass, double-submit, pay-500 | submit, and watch what the server does |

The checkout cart starts empty, so there is no "initial price" to check: even the math bug `wrong-total`
(shipping charged per cart line) only appears once two items are in the cart. Kane's main flow adds three items,
removes one, bumps a quantity and applies a coupon *before* it asserts the totals, which is why it sees all three
kinds. `stale-quote-on-qty` is the sharpest state case: the quote is memoised on the number of cart lines, so it is
correct after every add, remove and coupon, and wrong only right after a `+` click.
Measured: Kane caught all three state bugs. On `stale-quote-on-qty` it reported "the follow-up cart view still shows
quantity 1 and a $42.00 subtotal, even though the increase control was clicked", which names the input change, not
just a wrong number. Claude healed `stale-cart` in one round (8.4 min, 123,438 tokens).

One finding from the hardcoder run: Kane's *verdict and evidence* were right ("shipping is $8.00 and total $49.50"),
but its prose explanation blamed a missed click that its own step log shows succeeded. Hydra therefore feeds the
builder Kane's raw evidence lines, not just the summary.

## Commands

| Command | What it does |
|---|---|
| `hydra run --seed N [--builder claude] [--bug id] [--mutator] [--escalate] [--no-confirm]` | Full loop. Exit 0 healed, 1 aborted/rejected, 2 infra/config, 3 MISS |
| `hydra replay <seed>` / `hydra demo --replay` | Replay a recorded run in the arena from the ledger and stored evidence |
| `hydra arena` / `hydra export-arena -o docs` | Live spectator view (SSE) / static export for a public URL (GitHub Pages) |
| `hydra video --run <id...>` | Render a WebM per Kane run (referee, first verify, holdout) from Kane's step screenshots, since Kane saves no local video |
| `hydra demo-pack --run <id...>` | Bundle finished runs (ledger + displayed evidence + videos) into `demo/` |
| `hydra verify [--url] [--spec] [--claude-stop-hook]` | One-shot Kane check of the running app (0 pass, 1 fail, 2 infra) |
| `hydra chaos list \| seed N \| validate \| calibrate` | Inspect the bug library, prove each bug breaks the app, measure Kane's real detection |
| `hydra soak -n 10` | Run the main spec N times on the unmodified app and count flakes |
| `hydra bench --builders a,b --seeds 1,2,3` | Same seeds across builders, results table |
| `hydra stats` | Detection rate, MISS count, rounds to green, tokens per heal, holdout fail rate |
| `hydra init [--ci]` | Drop a spec, config and Claude Code Stop hook (and optionally a GitHub Action) into a repo |
| `hydra mcp` | MCP server exposing `hydra_verify` and `hydra_ledger` |

## Chaos library

Twelve pre-validated bugs. `hydra chaos validate` applies each one, builds and boots the app, and confirms with a scripted
ground-truth oracle that it breaks exactly the checks it declares. `hydra chaos calibrate` then runs Kane's main flow
against each bug (results in `chaos/calibration.json`). MISSes are logged, not hidden.

**Measured with kane-cli 0.10.4: Kane caught 9 of 12 (75%)**, including all three state bugs. All three misses are bugs outside the main flow's path
(a bad email, a double click, a fixed-amount coupon), which is what the holdout flow and the spec agent are for.
On the unmodified app, a 10-run soak passed 10/10 (≈48 credits and ≈220 s per run).

| Bug | Class | Surface | Seed | Breaks | Kane (measured) |
|---|---|---|---|---|---|
| dead-pay-button | interaction | flow | 0 | main, holdout | caught |
| pay-500 | server | flow | 1 | main, holdout | caught |
| currency-format | display | math | 2 | main, holdout | caught |
| off-by-one-qty | state | state | 3 | main, holdout | caught |
| fixed-coupon-ignored | coupon | math | 4 | holdout | **missed** |
| double-submit | concurrency | flow | 6 | double-click | **missed** |
| wrong-total | pricing | math | 7 | main, holdout | caught |
| coupon-ignored | coupon | math | 8 | main, holdout | caught |
| stale-cart | state | state | 12 | main | caught |
| validation-bypass | validation | flow | 14 | invalid-email | **missed** |
| confirmation-amount | display | math | 30 | main, holdout | caught |
| stale-quote-on-qty | state | state | `--bug` | main, holdout | caught |

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

## Confirmed verdicts

Kane is non-deterministic, so the run that decides CATCH or MISS is never trusted alone. The referee runs twice; if the
two runs disagree, a third decides, and the builder gets the evidence of a run that agrees with the majority. The
arena shows the vote ("confirmed 2 of 3"). Deployment has its own confirmation: two fresh main-flow passes plus the
hidden holdout. `--no-confirm` saves one or two Kane runs per loop. The six recorded runs predate this and used a
single referee run.

## Tests

```sh
npm test            # 25 unit tests: chaos library, anti-cheat, spec lock, deploy gate, heal-prompt leaks,
                    # Kane exit codes → verdicts, config, export path scrubbing, stats over the recordings
npm run test:loop   # the whole loop, end to end, ~3 minutes, no Kane credits
```

`test:loop` runs the real orchestrator: it builds and boots the real app, plants the real `wrong-total` bug and calls a
stand-in referee ([fake-kane.mjs](test/fixtures/fake-kane.mjs)) that reads the cart, coupon and expected totals from
the plain-English spec and checks them against the running app over HTTP. It covers an honest heal that deploys, a
flaky referee run that gets outvoted, the spec-editing cheater and the hardcoder. CI runs both suites on every push.

## The live challenge

[`scripts/build-playground.mjs`](scripts/build-playground.mjs) copies the target app and applies one library bug
with the same edits `hydra run` uses: `stale-cart`, `validation-bypass` (a bug Kane missed) and `wrong-total`. Each
copy is its own Vercel project. The [challenge page](arena/play.html) compares a player's answer and time with Kane's
recorded verdict and time on the same bug.

## Limits

- **One app.** All recorded runs use the bundled checkout. The chaos library is written against it, so a new app
  needs its own bugs (or the `--mutator`, which lets an LLM write one and validates it with the oracle).
- **Small sample.** The leaderboard has 6 recorded runs. It shows how Hydra scores agents, not a verdict on them.
- **Kane misses bugs off its path.** All three misses are behaviours the main flow never exercises (a bad email, a
  double click, a fixed-amount coupon). The holdout and the spec agent narrow that gap; they do not close it.
- **The loop test's referee is a stand-in.** It checks prices over HTTP, not a browser, so it proves the loop's
  logic (gate, anti-cheat, confirmation, prompts), not Kane's detection. Kane's detection is measured separately
  with `hydra chaos calibrate`.
- **Cost.** A healed run is about 6 Kane runs (≈280 credits) and 10 minutes; confirmation adds one or two runs.

## Development

```sh
npm run typecheck
npm test
npm run test:loop
node bin/hydra.js export-arena --state demo -o docs   # re-publish the static arena
```

## License

MIT
