// SpecLoop labs: two questions a green suite cannot answer by itself.
//
//   mutate  Would the spec catch a real bug? Inject plausible regressions into a copy of app/,
//           ask Kane CLI, score the spec, and turn survivors into new requirements.
//   bisect  Which commit broke this requirement? git bisect, with Kane CLI in a real browser
//           as the oracle at every step, then hand the culprit diff to the agent.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ---------- shared ----------

// Run Kane on some requirement ids against whatever is being served. Returns Map(id -> result).
async function kane(c, ids) {
  if (!ids.length) return new Map();
  const { code, text } = await c.runKane(ids);
  const parsed = c.parseStream(text);
  if (code === 2 && !parsed.results.size) throw new Error("Kane CLI could not run (auth or setup). See .specloop/stderr.log");
  return parsed.results;
}

function verdict(results, ids) {
  const failed = [];
  const broken = [];
  for (const id of ids) {
    const r = results.get(id);
    if (!r) broken.push({ id, message: "not run" });
    else if (r.status === "failed") failed.push({ id, message: r.message });
    else if (r.status !== "passed") broken.push({ id, message: r.message || r.status });
  }
  return { failed, broken };
}

async function withServedApp(c, dir, fn) {
  let server;
  try {
    server = await c.serve(c.PORT, dir);
  } catch (e) {
    throw new Error(`could not serve on port ${c.PORT} (${e.code || e.message}). Stop anything already serving there.`);
  }
  try { return await fn(); } finally { server.close(); }
}

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `specloop-${tag}-`));
}

function write(c, name, content) {
  fs.mkdirSync(c.OUT, { recursive: true });
  fs.writeFileSync(path.join(c.OUT, name), content);
  if (process.env.GITHUB_STEP_SUMMARY && name.endsWith(".md") && !name.includes("prompt")) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, content + "\n");
  }
}

function ids(list) {
  return String(list || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
}

// ---------- mutate ----------

function loadMutants(c) {
  return JSON.parse(fs.readFileSync(path.join(c.ROOT, "mutants.json"), "utf8")).mutants;
}

// Copy app/ and apply one mutant. The find text must appear exactly once.
function mutantApp(c, m) {
  const root = tmpDir(m.id.toLowerCase());
  fs.cpSync(c.APP, path.join(root, "app"), { recursive: true });
  const file = path.join(root, m.file);
  const src = fs.readFileSync(file, "utf8");
  const n = src.split(m.find).length - 1;
  if (n !== 1) throw new Error(`${m.id}: expected the find text once in ${m.file}, found ${n}. Update mutants.json.`);
  fs.writeFileSync(file, src.replace(m.find, m.replace));
  return root;
}

// Try the likely requirements first; only a full pass of the spec makes a mutant a survivor.
async function runMutant(c, m, first, allIds) {
  const root = mutantApp(c, m);
  try {
    return await withServedApp(c, path.join(root, "app"), async () => {
      const firstIds = first.filter((id) => allIds.includes(id));
      c.log(`🧬 ${m.id} ${m.title} — Kane on ${firstIds.join(", ") || "(none)"}`);
      let res = await kane(c, firstIds);
      let v = verdict(res, firstIds);
      let ran = [...firstIds];
      if (!v.failed.length) {
        const rest = allIds.filter((id) => !firstIds.includes(id));
        if (rest.length) {
          c.log(`🧬 ${m.id} not caught yet — Kane on the rest of the spec: ${rest.join(", ")}`);
          const res2 = await kane(c, rest);
          const v2 = verdict(res2, rest);
          v = { failed: [...v.failed, ...v2.failed], broken: [...v.broken, ...v2.broken] };
          ran = ran.concat(rest);
        }
      }
      const status = v.failed.length ? "killed" : (v.broken.length ? "error" : "survived");
      c.log(`🧬 ${m.id} ${status === "killed" ? "💀 killed by " + v.failed.map((f) => f.id).join(", ") : status === "survived" ? "🟡 SURVIVED the whole spec" : "⚠️ error"}`);
      return { id: m.id, title: m.title, file: m.file, find: m.find, replace: m.replace, status, killedBy: v.failed, errors: v.broken, ran };
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function mutationMarkdown(rep) {
  const icon = { killed: "💀 killed", survived: "🟡 survived", error: "⚠️ error" };
  const lines = [
    "## SpecLoop mutate: does the spec catch real bugs?",
    "",
    `**Mutation score: ${rep.killed}/${rep.total}** — ${rep.killed} of ${rep.total} injected regressions were caught by Kane CLI running spec.md in a real browser.`,
    "",
    "| Mutant | Injected bug | Result | Caught by |",
    "|---|---|---|---|",
  ];
  for (const m of rep.mutants) {
    const by = m.killedBy.map((k) => k.id).join(", ") || (m.status === "survived" ? `passed all ${m.ran.length} requirements` : m.errors.map((e) => `${e.id}: ${e.message}`).join("; "));
    lines.push(`| ${m.id} | ${m.title} | ${icon[m.status]} | ${by} |`);
  }
  if (rep.recheck) {
    lines.push("", "### After strengthening the spec", "");
    lines.push(`New requirements: ${rep.recheck.newReqs.map((r) => `**${r.id}** ${r.title} (${r.onRealApp})`).join("; ") || "none"}`);
    for (const m of rep.recheck.mutants) lines.push(`- ${m.id} ${m.title}: ${icon[m.status]}${m.killedBy.length ? " by " + m.killedBy.map((k) => k.id).join(", ") : ""}`);
  }
  return lines.join("\n") + "\n";
}

function specGapPrompt(rep, nextId) {
  const surv = rep.mutants.filter((m) => m.status === "survived");
  if (!surv.length) return "";
  const parts = [
    "SpecLoop injected these bugs into the app and Kane CLI ran EVERY requirement in spec.md against them in a real browser. They all passed, so the spec has a gap: a regression like this would ship.",
    "",
    "Add new requirements to spec.md so Kane would catch each bug below.",
    "",
    "Rules:",
    `- Append them at the end of spec.md, numbered from ${nextId}, in the same format: "## R<n>: <title>", then plain-English "- " bullets, one per step, and the last bullet starts with "Verify".`,
    "- Each new requirement must PASS on the current app and FAIL on the bug. Use exact amounts and names, the same way the existing requirements do.",
    "- Describe what a user sees, not how the code works. Do not mention the bug or the mutant.",
    "- Edit only spec.md. Do not edit app/, tests/ or mutants.json.",
    "",
  ];
  for (const m of surv) {
    parts.push(`### ${m.id}: ${m.title}`, `In ${m.file}, this line:`, "```js", m.find, "```", "was changed to:", "```js", m.replace, "```", "");
  }
  return parts.join("\n");
}

function nextReqId(reqs) {
  const n = Math.max(0, ...reqs.map((r) => Number(r.id.slice(1))));
  return `R${n + 1}`;
}

async function recheck(c, before) {
  const g = c.gen({ quiet: true });
  if (!g) return 2;
  const allIds = g.reqs.map((r) => r.id);
  const newReqs = g.reqs.filter((r) => !before.reqs.includes(r.id));
  const survivors = before.mutants.filter((m) => m.status === "survived");
  if (!newReqs.length) { c.log("no new requirements in spec.md since the last mutate run"); return 1; }
  c.log(`🔁 recheck: new requirements ${newReqs.map((r) => r.id).join(", ")}; survivors ${survivors.map((m) => m.id).join(", ") || "none"}`);

  // 1. A new requirement is only useful if it passes on the real app.
  const realRes = await withServedApp(c, c.APP, () => kane(c, newReqs.map((r) => r.id)));
  const realV = verdict(realRes, newReqs.map((r) => r.id));
  const newInfo = newReqs.map((r) => ({
    id: r.id, title: r.title,
    onRealApp: realV.failed.some((f) => f.id === r.id) ? "❌ fails on the real app" : realV.broken.some((b) => b.id === r.id) ? "⚠️ not run" : "✅ passes on the real app",
  }));

  // 2. Re-run each survivor, new requirements first.
  const catalog = loadMutants(c);
  const again = [];
  for (const s of survivors) {
    const m = catalog.find((x) => x.id === s.id) || s;
    again.push(await runMutant(c, m, newReqs.map((r) => r.id), allIds));
  }
  const rep = { ...before, recheck: { at: new Date().toISOString(), newReqs: newInfo, mutants: again } };
  for (const a of again) {
    const i = rep.mutants.findIndex((m) => m.id === a.id);
    if (i >= 0 && a.status === "killed") rep.mutants[i] = { ...rep.mutants[i], status: "killed", killedBy: a.killedBy };
  }
  rep.killed = rep.mutants.filter((m) => m.status === "killed").length;
  rep.reqs = allIds;
  write(c, "mutation.json", JSON.stringify(rep, null, 2));
  const md = mutationMarkdown(rep);
  write(c, "MUTATION.md", md);
  console.log(md);
  const ok = newInfo.every((r) => r.onRealApp.startsWith("✅")) && again.every((m) => m.status === "killed");
  return ok ? 0 : 1;
}

export async function mutate(c) {
  const { opt } = c;
  if (opt.recheck) {
    const f = path.join(c.OUT, "mutation.json");
    if (!fs.existsSync(f)) { c.log("run `specloop mutate` first"); return 2; }
    return recheck(c, JSON.parse(fs.readFileSync(f, "utf8")));
  }
  const g = c.gen({ quiet: true });
  if (!g) return 2;
  const allIds = g.reqs.map((r) => r.id);
  let catalog = loadMutants(c);
  if (opt.only) { const want = ids(opt.only); catalog = catalog.filter((m) => want.includes(m.id)); }

  const results = [];
  for (const m of catalog) {
    try { results.push(await runMutant(c, m, m.checks || [], allIds)); }
    catch (e) { c.log(`⚠️ ${m.id}: ${e.message}`); results.push({ id: m.id, title: m.title, file: m.file, find: m.find, replace: m.replace, status: "error", killedBy: [], errors: [{ id: "-", message: e.message }], ran: [] }); }
  }
  const rep = {
    at: new Date().toISOString(),
    reqs: allIds,
    total: results.length,
    killed: results.filter((m) => m.status === "killed").length,
    mutants: results,
  };
  write(c, "mutation.json", JSON.stringify(rep, null, 2));
  const md = mutationMarkdown(rep);
  write(c, "MUTATION.md", md);
  const prompt = specGapPrompt(rep, nextReqId(g.reqs));
  write(c, "spec-gap-prompt.md", prompt);
  console.log(md);

  const agentCmd = typeof opt.agent === "string" ? opt.agent : "";
  if (prompt && agentCmd) {
    await c.runAgent(agentCmd, prompt, "spec-gap-prompt.md");
    return recheck(c, rep);
  }
  return rep.killed === rep.total ? 0 : 1;
}

// ---------- bisect ----------

function git(c, args) {
  return execFileSync("git", args, { cwd: c.ROOT, encoding: "utf8" }).trim();
}

function appAt(c, sha) {
  const root = tmpDir(`bisect-${sha.slice(0, 7)}`);
  const tar = execFileSync("git", ["archive", sha, "app"], { cwd: c.ROOT, maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", root], { input: tar });
  return root;
}

export async function bisect(c) {
  const { opt } = c;
  const reqIds = ids(opt.req);
  if (!reqIds.length || !opt.good) { c.log('usage: specloop bisect --req R6 --good <sha> [--bad HEAD] [--agent "<cmd>"]'); return 2; }
  const g = c.gen({ quiet: true });
  if (!g) return 2;
  const unknown = reqIds.filter((id) => !g.reqs.some((r) => r.id === id));
  if (unknown.length) { c.log(`unknown requirement(s): ${unknown.join(", ")}`); return 2; }

  const good = git(c, ["rev-parse", String(opt.good)]);
  const bad = git(c, ["rev-parse", String(opt.bad || "HEAD")]);
  const commits = git(c, ["rev-list", "--reverse", "--first-parent", `${good}..${bad}`]).split("\n").filter(Boolean);
  if (!commits.length) { c.log("no commits between good and bad"); return 2; }
  const subject = (sha) => git(c, ["log", "-1", "--format=%s", sha]);
  const probes = [];

  // Today's tests (from today's spec) against the app as it was at each commit.
  async function probe(sha, why) {
    const root = appAt(c, sha);
    try {
      c.log(`🔎 ${why}: ${sha.slice(0, 7)} ${subject(sha)}`);
      const res = await withServedApp(c, path.join(root, "app"), () => kane(c, reqIds));
      const v = verdict(res, reqIds);
      const result = v.failed.length ? "bad" : v.broken.length ? "error" : "good";
      const message = v.failed.map((f) => `${f.id}: ${f.message}`).join("; ");
      probes.push({ sha, short: sha.slice(0, 7), subject: subject(sha), why, result, message });
      c.log(`   → ${result === "bad" ? "🔴 bad" : result === "good" ? "🟢 good" : "⚠️ error"}${message ? " — " + message : ""}`);
      if (result === "error") throw new Error(`Kane could not decide on ${sha.slice(0, 7)}: ${v.broken.map((b) => b.id + " " + b.message).join("; ")}`);
      return result;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  c.log(`🔎 bisecting ${reqIds.join(", ")} over ${commits.length} commit(s): about ${Math.ceil(Math.log2(commits.length + 1)) + 2} Kane runs`);
  if ((await probe(bad, "confirm bad")) !== "bad") { c.log(`${reqIds.join(", ")} passes at ${bad.slice(0, 7)}; nothing to bisect`); return finishBisect(c, { reqIds, good, bad, commits, probes, culprit: null }); }
  if (!opt["trust-good"] && (await probe(good, "confirm good")) !== "good") { c.log(`${reqIds.join(", ")} already fails at the good commit ${good.slice(0, 7)}; pick an older one`); return finishBisect(c, { reqIds, good, bad, commits, probes, culprit: null }); }

  let lo = -1;                 // index of the last known good (-1 = the good commit)
  let hi = commits.length - 1; // index of the first known bad
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await probe(commits[mid], `step ${probes.length - 1}`)) === "bad") hi = mid; else lo = mid;
  }
  const culprit = commits[hi];
  const code = await finishBisect(c, { reqIds, good, bad, commits, probes, culprit });

  const agentCmd = typeof opt.agent === "string" ? opt.agent : "";
  if (culprit && agentCmd) {
    await c.runAgent(agentCmd, fs.readFileSync(path.join(c.OUT, "bisect-fix-prompt.md"), "utf8"), "bisect-fix-prompt.md");
    const res = await withServedApp(c, c.APP, () => kane(c, reqIds));
    const v = verdict(res, reqIds);
    const fixed = !v.failed.length && !v.broken.length;
    c.log(fixed ? `🟢 ${reqIds.join(", ")} passes again after the agent's fix` : `🔴 still failing after the agent's fix`);
    fs.appendFileSync(path.join(c.OUT, "BISECT.md"), `\n**After the agent's fix:** ${fixed ? "🟢 " + reqIds.join(", ") + " passes again (Kane CLI)" : "🔴 still failing"}\n`);
    return fixed ? 0 : 1;
  }
  return code;
}

function finishBisect(c, b) {
  const lines = ["## SpecLoop bisect: which commit broke it?", ""];
  lines.push(`Requirement${b.reqIds.length > 1 ? "s" : ""} **${b.reqIds.join(", ")}**, today's Kane tests run against the app at each commit, ${b.good.slice(0, 7)}..${b.bad.slice(0, 7)} (${b.commits.length} commits).`, "");
  lines.push("| # | Commit | Why | Kane |", "|---|---|---|---|");
  b.probes.forEach((p, i) => lines.push(`| ${i + 1} | \`${p.short}\` ${p.subject.replace(/\|/g, "\\|")} | ${p.why} | ${p.result === "bad" ? "🔴 bad" : p.result === "good" ? "🟢 good" : "⚠️"} |`));
  let prompt = "";
  if (b.culprit) {
    const subj = git(c, ["log", "-1", "--format=%s", b.culprit]);
    const author = git(c, ["log", "-1", "--format=%an", b.culprit]);
    const diff = git(c, ["diff", `${b.culprit}^`, b.culprit, "--", "app/"]);
    const failing = b.probes.find((p) => p.sha === b.culprit)?.message || b.probes.find((p) => p.result === "bad")?.message || "";
    lines.push("", `**First bad commit: \`${b.culprit.slice(0, 7)}\` ${subj}** (by ${author}), found in ${b.probes.length} Kane runs.`, "");
    lines.push("```diff", diff.slice(0, 4000), "```");
    prompt = [
      `Kane CLI says requirement ${b.reqIds.join(", ")} from spec.md fails in a real browser, and SpecLoop bisect traced it to one commit.`,
      "",
      `First bad commit: ${b.culprit.slice(0, 7)} "${subj}"`,
      failing ? `Kane failure: ${failing}` : "",
      "",
      "Its change to app/:",
      "```diff", diff.slice(0, 8000), "```",
      "",
      "Fix app/ so the requirement passes again. Keep whatever that commit was trying to do if it is harmless; undo only the part that broke the requirement. Do not edit spec.md or tests/. Run npm test before you finish.",
    ].join("\n");
  }
  const md = lines.join("\n") + "\n";
  write(c, "BISECT.md", md);
  write(c, "bisect.json", JSON.stringify({ at: new Date().toISOString(), req: b.reqIds, good: b.good, bad: b.bad, commits: b.commits.length, probes: b.probes, culprit: b.culprit }, null, 2));
  write(c, "bisect-fix-prompt.md", prompt);
  console.log(md);
  return b.culprit ? 0 : 1;
}
