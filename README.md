# SpecLoop

[![Kane verify](https://github.com/aoyamari/specloop/actions/workflows/kane.yml/badge.svg)](https://github.com/aoyamari/specloop/actions/workflows/kane.yml)
[![Verified with Kane CLI](https://img.shields.io/badge/Kane%20CLI-verified-2ea44f)](https://testmuai.com/kane-cli)

**Your spec is the test suite. Kane CLI is the judge. Your coding agent is the fixer.**

You write requirements in plain English in `spec.md`. SpecLoop turns each one into a Kane CLI test. Kane runs them in a real browser, and any requirement that fails goes back to your coding agent as a fix prompt. Kane then runs again, and the loop repeats until every requirement is green. The same loop runs in three places:

| Where | What happens |
|---|---|
| **Claude Code** (Stop hook) | Claude can't finish its turn while Kane is red. The failures go straight back into the chat, and Claude keeps fixing (up to 3 rounds). |
| **Any agent / file watcher** | `npm run loop -- --agent "<cmd>" --watch` re-verifies on every save and pipes the failures into Codex, Gemini CLI, Hermes or anything that takes a prompt on stdin. |
| **GitHub Actions** | Every push and PR runs the whole spec through Kane in headless Chrome. The PR gets a verdict comment with video evidence, and the run uploads a requirement-by-requirement report plus the fix prompt. |
| **Auto-fix in CI** | When Kane fails on a PR, `kane-fix.yml` hands SpecLoop's fix prompt to Claude Code (official `claude-code-action`), re-runs Kane on the whole spec, and pushes a `[specloop-fix]` commit only if every requirement is green. Two rounds per run, two auto-fix commits per branch, then it hands back to a human. |

The demo app is **Patungan**, a bill splitter for friends: add members, add expenses, see who owes whom, and settle up in the fewest transfers.

**Live app:** https://aoyamari.github.io/specloop/

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
3. 🟢 SpecLoop re-runs Kane on the whole spec in the same job: **8/8**. Only then is the `[specloop-fix]` commit pushed, and the PR gets the report as a comment.

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
.claude/settings.json   Claude Code Stop hook
```

Built for the Kane CLI Online Hackathon (TestMu AI), November 2026.
