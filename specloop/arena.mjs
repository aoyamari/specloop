// SpecLoop arena: one planted bug, several coding agents, Kane CLI as the only judge.
//
//   node specloop/cli.mjs arena --mutant M2 --agents claude,gemini,codex
//
// Each agent gets its own copy of the repo with the same mutant from mutants.json planted
// in app/. SpecLoop's normal loop runs in that copy: Kane verifies the whole spec, the
// failures go to the agent as a fix prompt, Kane verifies again. An agent wins a round
// only when Kane says every requirement passes AND it left spec.md and tests/ alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

// Non-interactive commands for the agents people use most. {prompt_file} is replaced
// with the path of SpecLoop's fix prompt. Override any of them with --agents "name=cmd;;name=cmd".
export const PRESETS = {
  claude: 'claude -p --permission-mode acceptEdits "$(cat {prompt_file})"',
  gemini: 'gemini --yolo -p "$(cat {prompt_file})"',
  codex: 'codex exec --full-auto --skip-git-repo-check "$(cat {prompt_file})"',
  hermes: 'hermes chat -Q --query-file {prompt_file}',
  cursor: 'cursor-agent -p --force --trust "$(cat {prompt_file})"',
};

export function parseAgents(spec) {
  const raw = String(spec || "claude,gemini,codex");
  const parts = raw.includes("=") ? raw.split(";;") : raw.split(",");
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    if (i > 0) return { name: p.slice(0, i).trim(), cmd: p.slice(i + 1).trim() };
    if (!PRESETS[p]) throw new Error(`unknown agent "${p}". Use one of ${Object.keys(PRESETS).join(", ")} or name=command`);
    return { name: p, cmd: PRESETS[p] };
  });
}

function hashTree(root, rel) {
  const h = crypto.createHash("sha256");
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) {
        if (f.startsWith("output-") || f.startsWith(".")) continue; // Kane's own recordings
        walk(path.join(p, f));
      }
    } else h.update(path.relative(root, p)).update(fs.readFileSync(p));
  };
  walk(path.join(root, rel));
  return h.digest("hex");
}

export function lineDiff(a, b) {
  // Lines removed + lines added between two texts (multiset, order-insensitive). Small and honest enough for a scoreboard.
  const count = (s) => s.split("\n").reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const A = count(a), B = count(b);
  let removed = 0, added = 0;
  for (const [l, n] of A) removed += Math.max(0, n - (B.get(l) || 0));
  for (const [l, n] of B) added += Math.max(0, n - (A.get(l) || 0));
  return { removed, added };
}

function appDiff(origApp, newApp) {
  let removed = 0, added = 0;
  const files = [];
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(d, f)).isFile()) : []);
  for (const f of new Set([...list(origApp), ...list(newApp)])) {
    const a = fs.existsSync(path.join(origApp, f)) ? fs.readFileSync(path.join(origApp, f), "utf8") : "";
    const b = fs.existsSync(path.join(newApp, f)) ? fs.readFileSync(path.join(newApp, f), "utf8") : "";
    if (a === b) continue;
    const d = lineDiff(a, b);
    removed += d.removed; added += d.added; files.push(`app/${f}`);
  }
  return { files, removed, added };
}

function copyRepo(c, dest) {
  const skip = new Set([".git", "node_modules", ".specloop", ".testmuai", "kane-out", "_site"]);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(c.ROOT)) {
    if (skip.has(f)) continue;
    fs.cpSync(path.join(c.ROOT, f), path.join(dest, f), { recursive: true, filter: (s) => !path.basename(s).startsWith("output-") });
  }
  // The copy must not run SpecLoop's own Claude Code Stop hook: the arena drives the loop itself,
  // the same way for every agent. Every agent reads the same repo rules under its own file name.
  fs.rmSync(path.join(dest, ".claude"), { recursive: true, force: true });
  const rules = fs.readFileSync(path.join(c.ROOT, "CLAUDE.md"), "utf8");
  for (const f of ["AGENTS.md", "GEMINI.md"]) fs.writeFileSync(path.join(dest, f), rules);
}

function gitInit(dir) {
  // Some agents (Codex) only work inside a git repository.
  const g = (...a) => spawnSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q"); g("add", "-A");
  g("-c", "user.name=specloop-arena", "-c", "user.email=arena@specloop.invalid", "commit", "-qm", "arena: planted bug");
}

function run(cmd, args, cwd, logFile) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, "w");
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", out, out], env: { ...process.env, SPECLOOP_PARALLEL: process.env.SPECLOOP_PARALLEL || "2" } });
    child.on("close", (code) => { fs.closeSync(out); resolve(code); });
    child.on("error", () => { fs.closeSync(out); resolve(1); });
  });
}

function planted(c, root, m) {
  const file = path.join(root, m.file);
  const src = fs.readFileSync(file, "utf8");
  if (src.split(m.find).length - 1 !== 1) throw new Error(`${m.id}: find text must appear once in ${m.file}. Update mutants.json.`);
  fs.writeFileSync(file, src.replace(m.find, m.replace));
}

export function arenaMarkdown(rep) {
  const L = ["## SpecLoop arena: one bug, several agents, Kane CLI as the judge", ""];
  L.push(`Planted bug **${rep.mutant.id}**: ${rep.mutant.title}. Every agent got the same broken app and the same SpecLoop fix prompts; Kane verified the whole spec (${rep.reqs} requirements) after every round, up to ${rep.max} fix rounds.`, "");
  L.push("| Agent | Kane verdict | Fix rounds | Kane runs | Time | Lines the agent changed in app/ | Spec and tests untouched |", "|---|---|---|---|---|---|---|");
  for (const a of rep.agents) {
    const verdict = a.disqualified ? "⛔ disqualified" : a.green ? `🟢 ${a.reqs}/${a.reqs}` : `🔴 ${a.passed}/${a.reqs}`;
    L.push(`| ${a.name} | ${verdict} | ${a.fixRounds} | ${a.kaneRuns} | ${Math.round(a.seconds)} s | ${a.diff.removed + a.diff.added} (${a.diff.files.join(", ") || "none"})${a.diff.exactRevert ? ", exact revert" : ""} | ${a.specTouched ? "❌ changed" : "✅"} |`);
  }
  L.push("", "_Kane runs = full-spec Kane verifies, the first one included. An agent that edits spec.md or tests/ is disqualified even if Kane is green._", "");
  for (const a of rep.agents) if (a.fix) L.push(`<details><summary>${a.name}: what it changed</summary>`, "", "```diff", a.fix, "```", "</details>", "");
  return L.join("\n");
}

function unifiedish(origApp, newApp, files) {
  // A readable before/after of the changed lines (not a real patch format).
  const out = [];
  for (const f of files) {
    const rel = f.replace(/^app\//, "");
    const a = fs.existsSync(path.join(origApp, rel)) ? fs.readFileSync(path.join(origApp, rel), "utf8").split("\n") : [];
    const b = fs.existsSync(path.join(newApp, rel)) ? fs.readFileSync(path.join(newApp, rel), "utf8").split("\n") : [];
    const A = new Set(a), B = new Set(b);
    out.push(`--- ${f}`);
    for (const l of a) if (!B.has(l)) out.push(`-${l}`);
    for (const l of b) if (!A.has(l)) out.push(`+${l}`);
  }
  return out.slice(0, 60).join("\n");
}

export async function arena(c) {
  const { opt } = c;
  const agents = parseAgents(opt.agents);
  const catalog = JSON.parse(fs.readFileSync(path.join(c.ROOT, "mutants.json"), "utf8")).mutants;
  const m = catalog.find((x) => x.id === String(opt.mutant || "M2").toUpperCase());
  if (!m) { c.log(`unknown mutant ${opt.mutant}; see mutants.json`); return 2; }
  const g = c.gen({ quiet: true });
  if (!g) return 2;
  const max = Number(opt.max || 3);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "specloop-arena-"));
  const origApp = path.join(c.ROOT, "app");
  const results = [];
  c.log(`🏟️  arena: ${m.id} "${m.title}" vs ${agents.map((a) => a.name).join(", ")} (up to ${max} fix rounds each). Copies in ${base}`);
  for (const a of agents) {
    const dir = path.join(base, a.name);
    copyRepo(c, dir);
    planted(c, dir, m);
    const plantedApp = path.join(base, `${a.name}.planted-app`);
    fs.cpSync(path.join(dir, "app"), plantedApp, { recursive: true });
    gitInit(dir);
    const specBefore = hashTree(dir, "spec.md") + hashTree(dir, "tests");
    c.log(`▶ ${a.name}: ${a.cmd}`);
    const t0 = Date.now();
    const code = await run(process.execPath, [path.join(dir, "specloop/cli.mjs"), "loop", "--agent", a.cmd, "--max", String(max)], dir, path.join(base, `${a.name}.log`));
    const seconds = (Date.now() - t0) / 1000;
    const loopInfo = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, ".specloop/loop.json"), "utf8")); } catch { return {}; } })();
    const report = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, ".specloop/report.json"), "utf8")); } catch { return {}; } })();
    const specTouched = hashTree(dir, "spec.md") + hashTree(dir, "tests") !== specBefore;
    const diff = appDiff(plantedApp, path.join(dir, "app"));
    diff.exactRevert = appDiff(origApp, path.join(dir, "app")).files.length === 0;
    const r = {
      name: a.name, cmd: a.cmd, exit: code, seconds,
      green: !!loopInfo.green && !specTouched, disqualified: specTouched,
      kaneRuns: loopInfo.kaneRuns || 0, fixRounds: loopInfo.agentRuns || 0,
      passed: report.passed || 0, reqs: report.total || g.reqs.length,
      diff, specTouched, fix: unifiedish(plantedApp, path.join(dir, "app"), diff.files), log: path.join(base, `${a.name}.log`),
    };
    results.push(r);
    c.log(`  ${r.disqualified ? "⛔ edited spec.md or tests/" : r.green ? "🟢 green" : "🔴 still red"} after ${r.fixRounds} fix round(s), ${r.kaneRuns} Kane run(s), ${Math.round(seconds)} s. Log: ${r.log}`);
  }
  const rep = { at: new Date().toISOString(), mutant: { id: m.id, title: m.title }, max, reqs: g.reqs.length, agents: results };
  fs.mkdirSync(c.OUT, { recursive: true });
  fs.writeFileSync(path.join(c.OUT, "arena.json"), JSON.stringify(rep, null, 2));
  const md = arenaMarkdown(rep);
  fs.writeFileSync(path.join(c.OUT, "ARENA.md"), md);
  console.log("\n" + md);
  return results.some((r) => r.green) ? 0 : 1;
}
