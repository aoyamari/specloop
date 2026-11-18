# SpecLoop repo rules for coding agents

- `spec.md` is the source of truth. Each `## R<n>: …` requirement is a Kane CLI test.
- Fix behaviour in `app/` (and `app/logic.js` for the maths). Do not edit `spec.md` or `tests/` to make a failure go away.
- `tests/*_test.md` are generated: after changing `spec.md`, run `npm run gen` and commit the result.
- `npm test` runs the fast unit tests; `npm run verify` runs every requirement through Kane CLI in a real browser.
- A Stop hook (`.claude/settings.json`) runs Kane when you finish a turn that changed `app/` or `spec.md`. If it reports failures, read `.specloop/fix-prompt.md`, fix the app, and finish again.
