#!/usr/bin/env node
// SpecLoop: spec.md -> Kane CLI tests -> verdict -> coding agent fixes -> Kane again.
//
//   specloop serve                 serve app/ on http://localhost:4173
//   specloop gen                   spec.md -> tests/<id>_test.md
//   specloop verify [--only R4,R5] run every requirement through Kane CLI, write .specloop/
//   specloop loop --agent "<cmd>"  verify, hand failures to the agent, verify again (max N rounds)
//         [--watch]                ...and re-run whenever app/ or spec.md changes
//   specloop hook                  Claude Code Stop hook: Claude can't finish until Kane is green
//   specloop report --results <f>  CI: turn the Kane GitHub Action's results table into a spec report
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { generate, parseSpec } from "./spec.mjs";
import { parseStream, parseResultsTable, summarize, toMarkdown, fixPrompt } from "./report.mjs";
import { mutate, bisect } from "./lab.mjs";

import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT); // kane-cli discovers tests/ from the working directory
const OUT = path.join(ROOT, ".specloop");
const SPEC = path.join(ROOT, "spec.md");
const TESTS = path.join(ROOT, "tests");
const APP = path.join(ROOT, "app");

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) out[k] = true;
      else { out[k] = v; i += 1; }
    } else out._.push(a);
  }
  return out;
}

const opt = args(process.argv.slice(2));
const cmd = opt._[0] || "help";
const PORT = Number(opt.port || process.env.SPECLOOP_PORT || 4173);
const URL_ = opt.url || process.env.SPECLOOP_URL || `http://localhost:${PORT}`;
const log = (...m) => console.error("[specloop]", ...m);

// ---------- static server ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function serve(port = PORT, dir = APP) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.normalize(path.join(root, u));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

async function reachable(url) {
  try { const r = await fetch(url); return r.ok; } catch { return false; }
}

async function ensureServer() {
  if (await reachable(URL_)) return null;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(URL_)) throw new Error(`${URL_} is not reachable`);
  const s = await serve(PORT);
  log(`serving app/ on ${URL_}`);
  return s;
}

// ---------- gen ----------
function gen({ quiet } = {}) {
  const r = generate({ specPath: SPEC, outDir: TESTS, url: URL_ });
  if (r.problems.length) {
    for (const p of r.problems) log(`spec problem: ${p}`);
    process.exitCode = 2;
    return null;
  }
  if (!quiet || r.written.length || r.removed.length) {
    log(`${r.reqs.length} requirements -> tests/ (${r.written.length} written, ${r.removed.length} removed)`);
  }
  return r;
}

// ---------- verify ----------
function kaneArgs(only) {
  const a = ["testrun", "run", "--tags", "specloop", "--agent", "--headless", "--parallel", String(opt.parallel || process.env.SPECLOOP_PARALLEL || 2)];
  if (only.length) a.push("--match", only.map((id) => `${id.toLowerCase()}-`).join("|"));
  if (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY) {
    a.push("--username", process.env.LT_USERNAME, "--access-key", process.env.LT_ACCESS_KEY);
  }
  if (opt["kane-args"]) a.push(...String(opt["kane-args"]).split(/\s+/).filter(Boolean));
  return a;
}

function runKane(only) {
  return new Promise((resolve) => {
    fs.mkdirSync(OUT, { recursive: true });
    const streamFile = path.join(OUT, "stream.ndjson");
    const out = fs.createWriteStream(streamFile);
    const bin = process.env.KANE_BIN || "kane-cli";
    log(`$ ${bin} ${kaneArgs(only).map((x) => (x === process.env.LT_ACCESS_KEY ? "***" : x)).join(" ")}`);
    const child = spawn(bin, kaneArgs(only), { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let buf = "";
    let text = "";
    child.stdout.on("data", (d) => {
      out.write(d);
      text += d;
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const e = JSON.parse(line);
          if (e.type === "testrun_member_start") log(`▶ ${path.basename(e.path || "")}`);
          if (e.type === "testrun_member_end" || e.type === "testrun_authored_member_end") {
            log(`${e.status === "passed" ? "✅" : "❌"} ${path.basename(e.path || "")} ${e.status}${e.failure?.message ? ` — ${e.failure.message}` : ""}`);
          }
          if (e.type === "error") log(`kane error: ${e.message || e.code || line}`);
        } catch { /* not JSON */ }
      }
    });
    child.stderr.on("data", (d) => fs.appendFileSync(path.join(OUT, "stderr.log"), d));
    child.on("error", (err) => {
      log(`could not start ${bin}: ${err.message}. Install it with: npm install -g @testmuai/kane-cli`);
      resolve({ code: 2, text });
    });
    child.on("close", (code) => { out.end(); resolve({ code: code ?? 2, text }); });
  });
}

function appHash() {
  const h = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else h.update(p).update(fs.readFileSync(p));
    }
  };
  walk(APP);
  if (fs.existsSync(SPEC)) h.update(fs.readFileSync(SPEC));
  return h.digest("hex");
}

async function verify() {
  const g = gen({ quiet: true });
  if (!g) return { green: false, code: 2 };
  const onlyRaw = opt.only || process.env.SPECLOOP_ONLY || "";
  const only = onlyRaw ? String(onlyRaw).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean) : [];
  const reqs = only.length ? g.reqs.filter((r) => only.includes(r.id)) : g.reqs;
  const server = await ensureServer();
  try {
    const { code, text } = await runKane(only);
    const parsed = parseStream(text);
    const summary = summarize(reqs, parsed.results);
    const md = toMarkdown(summary);
    const prompt = fixPrompt(summary);
    fs.writeFileSync(path.join(OUT, "REPORT.md"), md);
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({
      at: new Date().toISOString(), kane_exit: code, overall: parsed.overall, green: summary.green,
      passed: summary.passed, total: summary.total,
      requirements: summary.rows.map((r) => ({ id: r.id, title: r.title, status: r.status, failure: r.res?.message || null })),
    }, null, 2));
    fs.writeFileSync(path.join(OUT, "fix-prompt.md"), prompt);
    console.log(md);
    if (summary.green) fs.writeFileSync(path.join(OUT, "last-green"), appHash());
    if (code === 2 && !parsed.results.size) log("Kane CLI could not run (auth or setup). See .specloop/stderr.log");
    return { green: summary.green && code === 0, code, summary, prompt };
  } finally {
    if (server) server.close();
  }
}

// ---------- agent loop ----------
function runAgent(agentCmd, prompt, name = "fix-prompt.md") {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, prompt);
  const usesFile = agentCmd.includes("{prompt_file}");
  const line = agentCmd.replaceAll("{prompt_file}", JSON.stringify(file));
  log(`🤖 handing ${name} to: ${agentCmd}`);
  return new Promise((resolve) => {
    const child = spawn(line, { shell: true, stdio: [usesFile ? "ignore" : "pipe", "inherit", "inherit"] });
    if (!usesFile) { child.stdin.write(prompt); child.stdin.end(); }
    child.on("close", (c) => resolve(c));
    child.on("error", () => resolve(1));
  });
}

async function loopOnce(agentCmd, max) {
  for (let round = 1; round <= max + 1; round += 1) {
    log(`— round ${round}: Kane verify —`);
    const r = await verify();
    if (r.green) { log(`🟢 all ${r.summary.total} requirements verified`); return true; }
    if (r.code === 2 && !r.summary?.rows.some((x) => x.res)) return false;
    if (!agentCmd || round > max) break;
    await runAgent(agentCmd, r.prompt);
  }
  log("🔴 still failing — see .specloop/REPORT.md");
  return false;
}

async function loop() {
  const agentCmd = typeof opt.agent === "string" ? opt.agent : process.env.SPECLOOP_AGENT || "";
  const max = Number(opt.max || 3);
  const ok = await loopOnce(agentCmd, max);
  if (!opt.watch) { process.exitCode = ok ? 0 : 1; return; }
  log("watching app/ and spec.md — save a file to re-verify (Ctrl+C to stop)");
  let timer = null;
  let running = false;
  let lastHash = appHash();
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) return;
      const h = appHash();
      if (h === lastHash) return;
      running = true;
      await loopOnce(agentCmd, max);
      lastHash = appHash();
      running = false;
    }, 1500);
  };
  fs.watch(APP, { recursive: true }, trigger);
  fs.watch(SPEC, trigger);
}

// ---------- Claude Code Stop hook ----------
async function hook() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { /* no stdin */ }
  fs.mkdirSync(OUT, { recursive: true });
  const stateFile = path.join(OUT, "hook-state.json");
  const max = Number(process.env.SPECLOOP_HOOK_MAX || 3);
  let st = { attempts: 0 };
  try { st = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { /* first run */ }

  const lastGreen = fs.existsSync(path.join(OUT, "last-green")) ? fs.readFileSync(path.join(OUT, "last-green"), "utf8") : "";
  if (appHash() === lastGreen) { fs.writeFileSync(stateFile, JSON.stringify({ attempts: 0 })); return 0; }
  if (!input.stop_hook_active) st.attempts = 0;
  if (st.attempts >= max) {
    fs.writeFileSync(stateFile, JSON.stringify({ attempts: 0 }));
    process.stderr.write(`SpecLoop: still red after ${max} fix rounds, stopping. See .specloop/REPORT.md\n`);
    return 0;
  }
  const r = await verify();
  if (r.green) { fs.writeFileSync(stateFile, JSON.stringify({ attempts: 0 })); return 0; }
  if (r.code === 2 && !r.summary?.rows.some((x) => x.res)) {
    process.stderr.write("SpecLoop: Kane CLI could not run (auth/setup), not blocking. See .specloop/stderr.log\n");
    return 0;
  }
  st.attempts += 1;
  fs.writeFileSync(stateFile, JSON.stringify(st));
  // Exit code 2 from a Stop hook keeps Claude working and shows it this text.
  process.stderr.write(`SpecLoop (fix round ${st.attempts}/${max}):\n${r.prompt}\n`);
  return 2;
}

// ---------- CI report ----------
function report() {
  const reqs = parseSpec(fs.readFileSync(SPEC, "utf8"));
  let parsed = { results: new Map() };
  // Prefer the raw stream (it carries failure reasons); fall back to the results table.
  if (opt.stream && fs.existsSync(opt.stream)) parsed = parseStream(fs.readFileSync(opt.stream, "utf8"));
  if (!parsed.results.size && opt.results && fs.existsSync(opt.results)) {
    parsed = parseResultsTable(fs.readFileSync(opt.results, "utf8"));
  }
  const summary = summarize(reqs, parsed.results);
  const md = toMarkdown(summary, { evidenceUrl: opt.evidence || "" });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "REPORT.md"), md);
  fs.writeFileSync(path.join(OUT, "fix-prompt.md"), fixPrompt(summary));
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({
    at: new Date().toISOString(), green: summary.green, passed: summary.passed, total: summary.total,
    requirements: summary.rows.map((r) => ({ id: r.id, title: r.title, status: r.status, failure: r.res?.message || null })),
  }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  if (opt.strict) process.exitCode = summary.green ? 0 : 1;
}

// Shared helpers for the mutation and bisect labs (specloop/lab.mjs).
function lab() {
  return { ROOT, OUT, APP, PORT, URL: URL_, opt, log, serve, runKane, parseStream, gen, runAgent };
}

const HELP = `SpecLoop — spec.md is the test suite, Kane CLI is the judge, your agent is the fixer.

  npm start                          serve the app on ${URL_}
  node specloop/cli.mjs gen          spec.md -> tests/*_test.md
  node specloop/cli.mjs verify       run all requirements through Kane CLI
  node specloop/cli.mjs loop --agent "claude -p" [--max 3] [--watch]
  node specloop/cli.mjs hook         Claude Code Stop hook (see .claude/settings.json)
  node specloop/cli.mjs mutate [--only M7,M8] [--agent "<cmd>"]   does the spec catch real bugs?
  node specloop/cli.mjs mutate --recheck                          after strengthening spec.md
  node specloop/cli.mjs bisect --req R6 --good <sha> [--bad HEAD] [--agent "<cmd>"]
`;

const main = {
  serve: async () => { await serve(PORT); log(`Patungan on ${URL_}`); },
  gen: async () => { gen(); },
  verify: async () => { const r = await verify(); process.exitCode = r.green ? 0 : (r.code === 2 ? 2 : 1); },
  loop,
  hook: async () => { process.exitCode = await hook(); },
  report: async () => report(),
  mutate: async () => { process.exitCode = await mutate(lab()); },
  bisect: async () => { process.exitCode = await bisect(lab()); },
  help: async () => console.log(HELP),
}[cmd];

if (!main) { console.log(HELP); process.exitCode = 2; } else await main();
