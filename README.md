# SpecLoop

[![Kane verify](https://github.com/aoyamari/specloop/actions/workflows/kane.yml/badge.svg)](https://github.com/aoyamari/specloop/actions/workflows/kane.yml)
[![Verified with Kane CLI](https://img.shields.io/badge/Kane%20CLI-verified-2ea44f)](https://testmuai.com/kane-cli)

**Your spec is the test suite. Kane CLI is the judge. Your coding agent is the fixer.**

You write requirements in `spec.md` as plain sentences, not test code. SpecLoop turns each one into a Kane CLI test. Kane runs them in a real browser, and any requirement that fails goes back to your coding agent as a fix prompt. Kane then runs again, and the loop repeats until every requirement is green. The same loop runs in three places:

| Where | What happens |
|---|---|
| **Claude Code** (Stop hook) | Claude can't finish its turn while Kane is red. The failures go straight back into the chat, and Claude keeps fixing (up to 3 rounds). |
| **Any agent / file watcher** | `npm run loop -- --agent "<cmd>" --watch` re-verifies on every save and pipes the failures into Codex, Gemini CLI, Hermes or anything that takes a prompt on stdin. |
| **GitHub Actions** | Every push and PR runs the whole spec through Kane in headless Chrome. The PR gets a verdict comment with video evidence, and the run uploads a requirement-by-requirement report plus the fix prompt. |
| **Mutation lab** | `kane-mutate.yml`: Kane scores the spec against injected regressions; Claude Code closes the gaps with new requirements; Kane proves them; a PR opens. |
| **Bisect lab** | `kane-bisect.yml`: Kane finds the first bad commit for a requirement; Claude Code fixes it from the culprit diff; Kane re-verifies. |
| **Auto-fix in CI** | When Kane fails on a PR, `kane-fix.yml` hands SpecLoop's fix prompt to Claude Code (official `claude-code-action`), re-runs Kane on the whole spec, and pushes a `[specloop-fix]` commit only if every requirement is green. Two rounds per run, two auto-fix commits per branch, then it hands back to a human. |

The demo app is **Patungan**, a bill splitter for friends: add members, add expenses, see who owes whom, and settle up in the fewest transfers.

**Live app:** https://aoyamari.github.io/specloop/ · **Spec status page:** https://aoyamari.github.io/specloop/status/ (rebuilt after every Kane verify, mutation and bisect run)

## Evidence: every claim, with the run that proves it

Every row is a real GitHub Actions run of Kane CLI in headless Chrome, or a real pull request. Nothing below is simulated.

| Claim | Proof |
|---|---|
| Kane catches a real regression on a PR | [PR #1](https://github.com/aoyamari/specloop/pull/1): Kane failed R5 ([run](https://github.com/aoyamari/specloop/actions/runs/44369501206)), the fix went in, then **8/8** ([run](https://github.com/aoyamari/specloop/actions/runs/44375025038)) |
| A UI redesign goes through the same gate | [PR #2](https://github.com/aoyamari/specloop/pull/2): **8/8** before merge ([run](https://github.com/aoyamari/specloop/actions/runs/44439915930)) |
| Claude Code can't finish its turn while Kane is red | Stop hook, recorded live on a VPS (shown in the demo video): Kane fails R5, Claude fixes `app/logic.js`, Kane passes, only then does the turn end |
| Auto-fix in CI with no human in the loop | [PR #3](https://github.com/aoyamari/specloop/pull/3): Kane failed R2 ([run](https://github.com/aoyamari/specloop/actions/runs/44458459485)); `kane-fix.yml` had Claude Code fix it, Kane re-ran **8/8** in the same job, and the bot pushed ([run](https://github.com/aoyamari/specloop/actions/runs/44460668860)) |
| Kane as the `git bisect` oracle | [PR #4](https://github.com/aoyamari/specloop/pull/4): culprit `7d521e1` found in **3 Kane runs** inside the auto-fix ([run](https://github.com/aoyamari/specloop/actions/runs/44504407751)); replayed on the same history in 5 runs, with the good and bad ends re-checked ([run](https://github.com/aoyamari/specloop/actions/runs/44513137460)) |
| The agent fixes from the culprit diff, not the whole branch | [PR #4](https://github.com/aoyamari/specloop/pull/4): commit `9f4e8d3` by the bot, one line changed back, the commit's shared comparator kept, Kane **8/8** before the push |
| The spec catches injected bugs | Mutation score **6/8** on the original spec ([run](https://github.com/aoyamari/specloop/actions/runs/44489509625)); M7 and M8 survived the whole spec |
| Mutation testing strengthens the spec itself | Claude Code wrote R9 and R10; Kane showed both pass on the real app and kill M7 and M8 (**8/8**); the bot opened [PR #5](https://github.com/aoyamari/specloop/pull/5) ([run](https://github.com/aoyamari/specloop/actions/runs/44496536608)) |
| `main` is green on the stronger spec | **10/10** on Kane after PR #5 ([run](https://github.com/aoyamari/specloop/actions/runs/44509075216)); live on the [status page](https://aoyamari.github.io/specloop/status/) |

### Known limits, stated plainly

- Kane was strict about wording. R2, R7 and R10 each needed a clearer sentence ("the app is expected to refuse it", a plain click step, the empty state the app actually shows). The meaning stayed the same and no test was weakened; every change is in the PR history.
- R8 (data survives a reload) failed in early runs because parallel Kane workers shared one `localStorage`. Each test now opens its own bill (`?bill=r8`). R8 also failed when the auto-fix called `kane-cli` directly with the runner's Chrome after a bisect; the auto-fix now verifies with the official Kane action, as the PR check does, and R8 passes. The exact cause of that second failure was not pinned down.
- The `--agent` hook works with any command that reads a prompt on stdin, but only Claude Code has been run end to end here. `specloop arena` (several agents on one bug) is built and dry-run with stubs, but not yet run with real Gemini CLI or Codex: both hit free-tier quota limits on the demo server.
- The Stop-hook proof is a screen recording, not a CI run.

## Proof: Kane caught a real bug

[PR #1](https://github.com/aoyamari/specloop/pull/1) is a harmless-looking refactor of `balances()`. In the refactor, every expense is split across the whole group instead of only the people ticked under "Split among".

1. 🔴 **Kane failed R5** in a real browser: *"Final verification failed: the Balances list says Budi gets back Rp 25.000, Andi owes Rp 25.000 and Citra is settled"*. The PR got a verdict comment with a link to the evidence pack (video + step trace).
2. The agent read the failure, fixed `app/logic.js` (commit message cites the Kane failure), and pushed.
3. 🟡 Kane re-ran: R5 was green. R7 flagged a spec ambiguity: "enter Amount 0 and click Add expense" read as a step that must succeed. The spec wording was fixed, not the test weakened.
4. 🟢 **8/8 requirements verified**, merged, and `main` is green.

## Proof: fixed with no human in the loop

[PR #3](https://github.com/aoyamari/specloop/pull/3) "simplifies" `validateMember()` and quietly makes the duplicate-name check case-sensitive.

1. 🔴 Kane CLI fails R2: *"An error saying Andi is already in the group is shown…"* was not true.
2. 🤖 `kane-fix.yml` hands SpecLoop's fix prompt to Claude Code in GitHub Actions. Claude edits only `app/logic.js`.
3. 🟢 SpecLoop re-runs Kane on the whole spec in the same job: **8/8** (the spec had 8 requirements then; it has 10 now). Only then is the `[specloop-fix]` commit pushed, and the PR gets the report as a comment.

## Who checks the checker? `specloop mutate`

A green suite only proves the spec passed. It does not prove the spec would catch anything. `specloop mutate` injects plausible regressions from `mutants.json` into a copy of `app/` (a case-sensitive duplicate check, a split across the wrong people, rounding leftovers dropped…) and lets Kane CLI run the spec against each one.

- Kane tries the most likely requirements first. A mutant only counts as **survived** after the **whole** spec has passed against it.
- The result is a **mutation score**.
- Each survivor is a gap in the spec. SpecLoop writes `spec-gap-prompt.md`, and the agent (Claude Code in CI via `kane-mutate.yml`) adds requirements for it, written as plain sentences.
- `specloop mutate --recheck` then proves two things with Kane: every new requirement **passes on the real app**, and it **kills its mutant**. Only then does the bot open a PR with the stronger spec.

**Proof:** Kane scored the original 8-requirement spec **6/8** ([run](https://github.com/aoyamari/specloop/actions/runs/44489509625)). Two mutants survived: rounding leftovers dropped (M7) and "Start over" keeping old expenses (M8). In the [strengthening run](https://github.com/aoyamari/specloop/actions/runs/44496536608), Claude Code wrote R9 "Rounding leftovers are not lost" and R10 "Start over clears everything". Kane showed both pass on the real app, R9 kills M7 and R10 kills M8, and the bot opened [PR #5](https://github.com/aoyamari/specloop/pull/5). **Mutation score: 8/8.**

## Which commit broke it? `specloop bisect`

`specloop bisect --req R6 --good <sha>` runs `git bisect` with today's Kane CLI test for R6 as the oracle. At every step the app is rebuilt from that commit and Kane runs R6 against it in a real browser, so it takes about log2(n) + 2 Kane runs. The first bad commit's diff and Kane's failure go to the agent as `bisect-fix-prompt.md`. In CI (`kane-bisect.yml`), Claude Code fixes it, Kane re-verifies, and the fix is pushed with a report on the PR. `kane-fix.yml` also runs it on its own when a failing PR has 3+ commits, so Claude gets the culprit diff instead of the whole branch.

**Proof:** [PR #4](https://github.com/aoyamari/specloop/pull/4) is six small "polish" commits. One of them, `7d521e1` "Settle-up: share one sort comparator", also swaps who pays whom. Kane failed R6, and bisect named `7d521e1` as the first bad commit in **3 Kane runs**, with the diff, in the PR comment. Claude Code got that diff, changed one line back (and kept the commit's shared comparator), Kane re-ran the whole spec (**8/8**), and the bot pushed the `[specloop-fix]` commit. No human touched the code.

## Same bug, several agents: `specloop arena`

`specloop arena --mutant M2 --agents claude,gemini,codex` plants one bug from `mutants.json` in a separate copy of the repo for each agent, then runs SpecLoop's normal loop there: Kane verifies the whole spec, the failures go to the agent as a fix prompt, and Kane verifies again (up to `--max` rounds). Kane is the only judge. An agent that edits `spec.md` or `tests/` is disqualified even when Kane is green. The result is `.specloop/ARENA.md`: Kane verdict, fix rounds, Kane runs, time, and the lines each agent changed.

Built-in commands: `claude -p`, `gemini --yolo -p`, `codex exec --full-auto`, `hermes chat -Q --query-file`, `cursor-agent -p --force`. Pick a model with a custom command, e.g. `--agents "claude;;grok=cursor-agent -p --force --trust --model <id> \"$(cat {prompt_file})\""`. Any other agent: `--agents "mine=my-agent {prompt_file}"`.

**Status:** unit-tested, and dry-run end to end with a stub Kane and three stub agents (a correct fix goes green, an agent that deletes R5 from the spec is disqualified, an agent that does nothing stays red). It has **not** been run with real Gemini CLI and Codex yet: on the demo server both hit free-tier quota limits, so there is no real scoreboard to show.

## How it works

```
spec.md ──gen──▶ tests/r*_test.md ──kane-cli testrun──▶ verdict per requirement
   ▲                                                           │
   │                                                     red?  ▼
   └──────── agent fixes app/ ◀──── .specloop/fix-prompt.md ◀──┘
```

1. **`spec.md`**: each `## R<n>: title` is a requirement, and each bullet under it is one step. The last bullet must verify something. `gen` lints this and refuses a requirement that checks nothing.
2. **`tests/`**: generated Kane `_test.md` files. Every test starts by resetting the app, so tests are independent and can run in parallel. CI fails if `tests/` is out of date with `spec.md`.
3. **`verify`** runs `kane-cli testrun run --agent --headless` and reads the NDJSON stream. It maps each `testrun_member_end` back to its requirement and writes `.specloop/REPORT.md`, `report.json` and `fix-prompt.md`.
4. **The fix prompt** lists, for each failure, the expected behaviour from the spec, Kane's failure message and step, and the log path. It tells the agent to fix `app/` and not to weaken the spec.

## Run it

Needs Node 20+ and Chrome.

```bash
npm install -g @testmuai/kane-cli
kane-cli login                    # or export LT_USERNAME / LT_ACCESS_KEY

npm start                         # app on http://localhost:4173
npm test                          # fast unit tests for the bill maths
npm run verify                    # every requirement through Kane CLI
npm run loop -- --agent "claude -p --permission-mode acceptEdits"   # verify → fix → verify
npm run watch -- --agent "claude -p --permission-mode acceptEdits"  # same, on every save
```

To use the loop with Claude Code, open this repo in Claude Code and work normally. `.claude/settings.json` already registers the Stop hook. If a turn changed `app/` or `spec.md`, Kane runs when Claude tries to finish, and a red result sends the failures back to Claude.

Environment knobs: `SPECLOOP_ONLY=R4,R5` runs only those requirements (handy for a fast hook), and `SPECLOOP_PARALLEL=2` sets how many Chrome workers Kane uses.

For other agents, use `--agent` with any shell command. By default the prompt arrives on stdin; put `{prompt_file}` in the command to receive a path instead.

## CI

`.github/workflows/kane.yml` runs on every push and PR. It runs the unit tests, checks that `tests/` matches the spec, serves the app, and runs the official `kane-cli-browser-run` action over `tests/**/*_test.md`. It then publishes the SpecLoop report to the job summary and uploads `.specloop/` (report + fix prompt) as an artifact. Repository secrets needed: `LT_USERNAME`, `LT_ACCESS_KEY`.

`.github/workflows/kane-fix.yml` closes the loop with no human in the middle: on a failed Kane run for a same-repo PR it downloads the fix prompt, lets Claude Code edit only `app/`, re-runs `specloop verify`, and pushes and comments only when Kane is green. Extra secret: `CLAUDE_CODE_OAUTH_TOKEN` (run `claude setup-token`).

`.github/workflows/pages.yml` deploys `app/` to GitHub Pages.

## Layout

```
spec.md                 requirements: the single source of truth
app/                    Patungan (static HTML/JS, no build step)
app/logic.js            pure bill-splitting maths (unit tested)
tests/                  generated Kane CLI _test.md files
specloop/cli.mjs        serve · gen · verify · loop · hook · report
specloop/spec.mjs       spec parser, linter, test generator
specloop/report.mjs     Kane NDJSON → requirement report + fix prompt
specloop/lab.mjs        mutate (mutation testing of the spec) · bisect (Kane as git bisect oracle)
specloop/arena.mjs      arena (one planted bug, several agents, Kane as the judge)
mutants.json            plausible regressions used by `specloop mutate`
.claude/settings.json   Claude Code Stop hook
```

Built for the Kane CLI Online Hackathon (TestMu AI), November 2026.
