// Builds a static "spec status" page from SpecLoop's latest CI reports.
//   node specloop/cli.mjs status --data <dir with verify/ mutation/ bisect/> --out <dir>
import fs from "node:fs";
import path from "node:path";
import { parseSpec } from "./spec.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function findJson(dir, name) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    if (path.basename(String(f)) === name) return readJson(path.join(dir, String(f)));
  }
  return null;
}

export function buildStatus({ root, dataDir, outDir, repo = "aoyamari/specloop", runs = {} }) {
  const reqs = parseSpec(fs.readFileSync(path.join(root, "spec.md"), "utf8"));
  const verify = findJson(path.join(dataDir, "verify"), "report.json");
  const mutation = findJson(path.join(dataDir, "mutation"), "mutation.json");
  const bisect = findJson(path.join(dataDir, "bisect"), "bisect.json");

  const status = new Map((verify?.requirements || []).map((r) => [r.id, r]));
  const kills = new Map();
  for (const m of mutation?.mutants || []) for (const k of m.killedBy || []) {
    if (!kills.has(k.id)) kills.set(k.id, []);
    kills.get(k.id).push(m.id);
  }
  const passed = reqs.filter((r) => status.get(r.id)?.status === "passed").length;
  const runLink = (id, label) => (id ? `<a href="https://github.com/${repo}/actions/runs/${id}">${esc(label)}</a>` : "");

  const rows = reqs.map((r) => {
    const s = status.get(r.id)?.status || "not run";
    const cls = s === "passed" ? "ok" : s === "not run" ? "na" : "bad";
    const k = kills.get(r.id) || [];
    return `<tr><td class="id">${r.id}</td><td>${esc(r.title)}<div class="steps">${r.steps.map((x) => esc(x)).join("<br>")}</div></td>
<td><span class="pill ${cls}">${s === "passed" ? "✓ passed" : s === "not run" ? "not run yet" : "✗ " + esc(s)}</span></td>
<td>${k.length ? k.map((x) => `<span class="mut">${x}</span>`).join(" ") : '<span class="muted">—</span>'}</td></tr>`;
  }).join("\n");

  const mutRows = (mutation?.mutants || []).map((m) => `<tr><td class="id">${m.id}</td><td>${esc(m.title)}</td>
<td><span class="pill ${m.status === "killed" ? "ok" : m.status === "survived" ? "warn" : "na"}">${m.status === "killed" ? "caught" : m.status}</span></td>
<td>${(m.killedBy || []).map((k) => k.id).join(", ") || '<span class="muted">—</span>'}</td></tr>`).join("\n");

  const bisectBlock = bisect?.culprit ? `<section class="card"><h2>Last bisect</h2>
<p>Requirement <b>${esc((bisect.req || []).join(", "))}</b> traced to <code>${esc(bisect.culprit.slice(0, 7))}</code> in ${bisect.probes.length} Kane run${bisect.probes.length === 1 ? "" : "s"} across ${bisect.commits} commits.</p>
<ol class="probes">${bisect.probes.map((p) => `<li><code>${esc(p.short)}</code> ${esc(p.subject)} <span class="pill ${p.result === "bad" ? "bad" : "ok"}">${p.result}</span></li>`).join("")}</ol>
<p>${runLink(runs.bisect, "Bisect run")}</p></section>` : "";

  const score = mutation ? `${mutation.killed}/${mutation.total}` : "—";
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Patungan spec status · SpecLoop</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--table:#dce4da;--ink:#18233d;--muted:#56607a;--paper:#fff;--kunyit:#f2b705;--sambal:#b4232c;--daun:#1e7a46;--rule:#c9cfdc}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 "Bricolage Grotesque",system-ui,sans-serif;background:var(--table);color:var(--ink)}
main{max-width:1080px;margin:0 auto;padding:40px 20px 60px}
h1{margin:0;font-size:clamp(2.4rem,6vw,4rem);font-weight:800;letter-spacing:-.04em;line-height:1}
.lead{color:var(--muted);max-width:60ch;margin:12px 0 28px}
.stats{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.stat{background:var(--paper);border-radius:14px;padding:16px 20px;min-width:220px}
.stat b{display:block;font-size:2.4rem;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.stat span{color:var(--muted);font-size:.95rem}
.card{background:var(--paper);border-radius:18px;padding:20px 22px;margin-bottom:18px;overflow-x:auto}
h2{margin:0 0 12px;font-size:1.35rem;font-weight:800;letter-spacing:-.02em}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-size:.85rem;color:var(--muted);font-weight:600}td.id{font-family:"Space Mono",monospace;font-weight:700;white-space:nowrap}
.steps{color:var(--muted);font-size:.85rem;margin-top:4px}
.pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.85rem;font-weight:700;white-space:nowrap}
.pill.ok{background:#e3f3e8;color:var(--daun)}.pill.bad{background:#fbe5e6;color:var(--sambal)}.pill.warn{background:#fff3c4;color:#6b5200}.pill.na{background:#eef1f6;color:var(--muted)}
.mut{font-family:"Space Mono",monospace;font-size:.85rem;background:#fff3c4;border-radius:6px;padding:1px 6px}
.muted{color:var(--muted)}code{font-family:"Space Mono",monospace;font-size:.9em}
.probes{margin:0;padding-left:20px}.probes li{margin:4px 0}
a{color:var(--ink);font-weight:600}footer{color:var(--muted);font-size:.9rem;margin-top:24px}
</style></head><body><main>
<h1>Spec status</h1>
<p class="lead">Every requirement in <a href="https://github.com/${repo}/blob/main/spec.md">spec.md</a>, as Kane CLI last saw it in a real browser on <code>main</code>, and which injected bugs each one catches. Built by SpecLoop from the latest CI runs.</p>
<div class="stats">
<div class="stat"><b>${verify ? `${passed}/${reqs.length}` : "—"}</b><span>requirements verified by Kane CLI</span></div>
<div class="stat"><b>${score}</b><span>mutation score: injected bugs the spec catches</span></div>
<div class="stat"><b>${reqs.length}</b><span>plain-English requirements in spec.md</span></div>
</div>
<section class="card"><h2>Requirements</h2><table><thead><tr><th>Req</th><th>Requirement</th><th>Kane on main</th><th>Catches</th></tr></thead><tbody>
${rows}
</tbody></table><p>${runLink(runs.verify, "Latest Kane verify run")}</p></section>
${mutation ? `<section class="card"><h2>Mutation testing</h2><p class="muted">Each mutant is a plausible regression injected into a copy of the app. A mutant is caught when Kane fails at least one requirement against it; it only survives after the whole spec has passed.</p><table><thead><tr><th>Mutant</th><th>Injected bug</th><th>Result</th><th>Caught by</th></tr></thead><tbody>
${mutRows}
</tbody></table><p>${runLink(runs.mutation, "Latest mutation run")}</p></section>` : ""}
${bisectBlock}
<footer>Patungan app: <a href="../">aoyamari.github.io/specloop</a> · Code: <a href="https://github.com/${repo}">github.com/${repo}</a></footer>
</main></body></html>`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  return { reqs: reqs.length, passed, score };
}
