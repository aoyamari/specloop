import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgents, lineDiff, arenaMarkdown, PRESETS } from "../specloop/arena.mjs";

test("parseAgents: presets by name", () => {
  const a = parseAgents("claude,codex");
  assert.deepEqual(a.map((x) => x.name), ["claude", "codex"]);
  assert.equal(a[1].cmd, PRESETS.codex);
});

test("parseAgents: custom commands with name=cmd;;name=cmd", () => {
  const a = parseAgents("mine=my-agent --fix;;other=other {prompt_file}");
  assert.deepEqual(a, [{ name: "mine", cmd: "my-agent --fix" }, { name: "other", cmd: "other {prompt_file}" }]);
});

test("parseAgents: unknown preset is an error", () => {
  assert.throws(() => parseAgents("nope"), /unknown agent/);
});

test("lineDiff counts a one-line change as 1 removed + 1 added", () => {
  assert.deepEqual(lineDiff("a\nb\nc", "a\nB\nc"), { removed: 1, added: 1 });
  assert.deepEqual(lineDiff("a\nb", "a\nb"), { removed: 0, added: 0 });
});

test("arenaMarkdown marks spec edits as disqualified even when green", () => {
  const md = arenaMarkdown({ mutant: { id: "M2", title: "t" }, reqs: 10, max: 3, agents: [
    { name: "x", green: false, disqualified: true, passed: 10, reqs: 10, fixRounds: 1, kaneRuns: 2, seconds: 60, diff: { files: ["app/logic.js"], removed: 1, added: 1 }, specTouched: true },
    { name: "y", green: true, disqualified: false, passed: 10, reqs: 10, fixRounds: 1, kaneRuns: 2, seconds: 50, diff: { files: ["app/logic.js"], removed: 1, added: 1 }, specTouched: false },
  ] });
  assert.match(md, /\| x \| ⛔ disqualified/);
  assert.match(md, /\| y \| 🟢 10\/10 \| 1 \| 2 \| 50 s/);
});

test("hermes preset reads the prompt from a file, so no shell quoting is involved", () => {
  const [h] = parseAgents("hermes");
  assert.equal(h.cmd, "hermes chat -Q --query-file {prompt_file}");
});

import { parseStream, summarize, fixPrompt } from "../specloop/report.mjs";
test("Kane running out of credits is a Kane error, never a fix prompt for the agent", () => {
  const ev = (f, status, message) => JSON.stringify({ type: "testrun_member_end", path: `tests/${f}`, status, failure: message ? { message } : undefined });
  const text = [ev("r1-a_test.md", "passed"), ev("r2-b_test.md", "failed", 'Credits exhausted: {"error":"insufficient credits"}')].join("\n");
  const s = summarize([{ id: "R1", title: "a", steps: [] }, { id: "R2", title: "b", steps: [] }], parseStream(text).results);
  assert.equal(s.kaneErrors, 1);
  assert.equal(s.green, false);
  assert.equal(fixPrompt(s), "");
});
