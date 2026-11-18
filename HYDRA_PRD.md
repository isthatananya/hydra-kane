# HYDRA: Product Requirements Document

## 1. Summary
Hydra is an open-source verification loop for AI coding agents. A builder agent ships an app, a chaos agent breaks it, and Kane CLI referees in a real browser. Nothing deploys until Kane passes, and Kane's failure evidence becomes the builder's next prompt.

## 2. Problem
Coding agents declare "done" without checking their work in a real browser. Existing loops feed back test logs or self-assessment. The agent grades its own homework, and regressions ship.

## 3. Users
- **Primary:** developers using Claude Code, Cursor or Codex who want an agent that can't claim done until a real browser agrees.
- **Secondary:** reviewers and judges who need to see the loop work in under a minute, without setup.

## 4. Goals
- A closed loop where Kane's output is the only input to the heal step.
- Evidence of Kane's detection quality, including its misses.
- Agent-agnostic: any builder that runs from a shell command works.
- A spectator view that makes the fail -> patch -> pass sequence obvious.
- Installable in one command.

## 5. Non-goals
- Multi-app support, authentication flows, or mobile.
- A hosted platform or a general-purpose test framework.
- A polished target app. The app is the punching bag, the loop is the product.

## 6. Constraints
- Kane CLI must be the verifier. The project must be public and demoable by a third party.
- **Kane contract:** run with `--headless`, `--agent` and `--timeout`. Exit codes: 0 verified, 1 failed assertion, 2 error such as auth.
- **Kane output:** the closing `run_end` NDJSON event carries status, summary, extracted values and a dashboard URL. Each run's evidence pack holds step JSON, screenshots, video, and command, network and console logs.
- **Kane behavior:** it re-resolves elements as the page shifts, ShareLinks last 7 days, and re-runs can replay from cache. The design must tolerate all three.
- **Judging bars:** it ships end to end, Kane catches or proves something, and agent and Kane talk to each other.

## 7. System overview

### Components
| Component | Responsibility |
|---|---|
| Target app | Next.js checkout (cart, coupon, pay). Seeded, deterministic, no auth, reset endpoint |
| Specs | Main Kane flow plus a hidden holdout flow |
| Kane wrapper | Spawns the CLI, parses NDJSON, maps exit codes, archives evidence |
| Chaos engine | Applies one bug per round from a taxonomy |
| Builder adapter | Runs any agent via a shell command template, in a sandbox |
| Orchestrator | State machine and ledger |
| Arena UI | Live and replay spectator view |
| Deploy gate | Promotes only on a verified pass |

### Loop
1. **BUILD:** the builder ships the app from the prompt.
2. **BASELINE:** Kane must pass the main spec twice, or the round is invalid.
3. **CHAOS:** one bug is applied. The builder never sees which one.
4. **REFEREE:** Kane runs the main spec.
   - Pass = **MISS**. Log it and escalate.
   - Exit code 1 = **CATCH**. Go to HEAL.
   - Exit code 2 or timeout = infra error. Retry. Never send to the builder.
5. **HEAL:** the builder receives a prompt built only from Kane evidence and patches.
6. **VERIFY:** fresh (non-cached) Kane runs, passing twice, then the holdout.
7. **DEPLOY:** promote only on a green VERIFY.
8. The loop caps at 5 heal rounds, then aborts with a report.

## 8. Functional requirements

### P0
- **FR1: Kane wrapper.** Spawns the CLI headless with `--agent` and streams events. Returns status, summary, failing step, `test_url` and `run_dir`. Copies evidence into a local run folder.
- **FR2: Chaos taxonomy.**
  - At least 8 bugs: wrong total, coupon ignored, dead pay button, stale cart state, validation bypass, double submit, 500 on pay, off-by-one quantity.
  - Each bug is a pre-validated patch, confirmed to break the app, with a known Kane outcome (caught or missed).
  - A seed maps to a bug, so runs are reproducible.
- **FR3: LLM mutator.** Sees the code but not the spec. Its patch is validated by apply, build and smoke before use. Falls back to the patch library on failure.
- **FR4: Builder adapter.** Takes a command template per agent. The prompt contains the Kane summary, failing step, logs, screenshot paths and ShareLink, and nothing else about the bug.
- **FR5: Anti-cheat.**
  - Spec files are read-only and their hash is checked after every patch.
  - Chaos is applied to the working tree with no revertable commit history.
  - The builder can only edit allowlisted paths.
  - The holdout flow (different coupon, different quantity) runs after the main spec passes.
- **FR6: Orchestrator and ledger.** Per round records bug id, verdict, exit code, diff, video path, timings and tokens. Exposes `hydra run`, `hydra replay <seed>` and `hydra demo --replay`.
- **FR7: Deploy gate.** Promote only after two fresh passes plus the holdout. No manual override flag in the default path.
- **FR8: Arena UI.** Shows current round, Kane verdict, embedded failure video, diff, and the FAIL -> patch -> PASS scoreboard. Updates live. Replay mode needs no Kane or LLM.

### P1
- **FR9: `init` command.** Drops the spec, config and hook into a repo.
- **FR10: MCP tool.** `hydra_verify` exposes the loop to agents.
- **FR11: GitHub Action.** Runs Kane on PRs, comments the video, blocks the merge until green.
- **FR12: Builder benchmark.** Same seeds across multiple builder agents, with a results table.

### P2
- **FR13: Escalation.** Each healed bug spawns two harder ones.
- **FR14: Spec agent.** On a MISS, a third agent writes a new Kane flow that catches the bug.
- **FR15: Bug-class heatmap** in the arena.

## 9. Non-functional requirements
- **Determinism:** pinned Chrome version, seeded data, no external network calls in the app.
- **Reliability:** 10 consecutive fixed-seed runs without a flake before any recording.
- **Reproducibility:** any run can be replayed from the ledger and stored evidence.
- **Cost control:** per-run credit cost is measured and a max-run budget is enforced.
- **Portability:** works from a clean clone with only Node, Chrome and a Kane login.
- **Evidence permanence:** videos and logs are copied locally because ShareLinks expire.

## 10. Metrics
- Rounds to green
- Time to heal
- Detection rate (catches / bugs injected)
- MISS count
- Tokens per heal
- Holdout fail rate (cheating detector)

## 11. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Builder cheats (revert, edit spec, hardcode) | FR5: read-only specs, squashed chaos, path allowlist, holdout flow |
| Chaos feels staged | Chaos sees code, not spec. Log MISSes honestly. Keep one real bug Kane caught during development |
| Kane flakiness or nondeterminism | Double pass, retry on exit code 2 and timeouts, pinned environment |
| Kane heals around the bug | Weight chaos toward functional bugs, assert on DOM and network evidence |
| Cache masks a regression | Fresh runs for every gate decision |
| Credit exhaustion | Measure cost per run, cap runs, request extra credits |
| Third party can't run it | Replay mode with stored evidence, plus a public arena URL |
| LLM variance breaks a demo | Seeded patch library, fixed-seed recordings |
| Name collisions (npm, project name) | Check and pick a unique package name |
| Repo-date eligibility rule | Fresh public repo, clean commit history |

## 12. Open questions
1. What is the credit cost per Kane run, and how many runs does a full loop need?
2. How reliably does Kane detect each bug class? Run the patch library against it to find out.
3. Does Kane's cached replay ever mask a regression? Test with and without cache.
4. Which builder agents can run fully headless in a sandbox with a command template?
5. Can the holdout flow reliably catch a hardcoded fix? Test with a deliberately cheating builder.
6. Should the arena stream live from the orchestrator or read the ledger by polling?

## 13. Acceptance criteria
- From a clean clone, `hydra run --seed N` goes from a passing app to an injected bug, a Kane fail with video, a builder patch, a double pass plus holdout, and a deploy.
- A deliberately cheating builder (hardcoded coupon, edited spec) is rejected by the gate.
- A MISS is logged and visible in the arena.
- Replay mode reproduces a full run with no live Kane or LLM.
- The same seed across two different builder agents produces comparable ledger entries.
