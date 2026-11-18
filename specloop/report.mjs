// Turns Kane CLI results into a requirement-by-requirement report and an agent fix prompt.
import { reqIdFromPath } from "./spec.mjs";

// Parse a `kane-cli testrun run --agent` NDJSON stream.
export function parseStream(text) {
  const events = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && typeof o === "object") events.push(o); } catch { /* not JSON */ }
  }
  const results = new Map();
  for (const e of events) {
    if (e.type !== "testrun_member_end" && e.type !== "testrun_authored_member_end") continue;
    const id = reqIdFromPath(e.path);
    if (!id) continue;
    results.set(id, {
      status: e.status,
      duration: e.duration_s,
      message: e.failure?.message || "",
      stepIndex: e.failure?.step_index,
      logPath: e.log_path || "",
    });
  }
  const done = [...events].reverse().find((e) => e.type === "testrun_done");
  const errors = events.filter((e) => e.type === "error" || e.type === "remote_error");
  return { results, overall: done?.overall_status || "", errors };
}

// Parse the Markdown results table written by the kane-cli-browser-run GitHub Action:
// | `tests/r1-..._test.md` | :white_check_mark: passed | 12.3s | - |
export function parseResultsTable(text) {
  const results = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*(?::\w+:\s*)?([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (!m) continue;
    const id = reqIdFromPath(m[1]);
    if (!id) continue;
    results.set(id, { status: m[2].trim(), duration: parseFloat(m[3]) || undefined, message: "" });
  }
  return { results, overall: "", errors: [] };
}

const ICON = { passed: "✅", failed: "❌", broken: "💥", interrupted: "⏹️" };

export function summarize(reqs, results) {
  const rows = reqs.map((r) => {
    const res = results.get(r.id);
    return { ...r, status: res ? res.status : "not run", res };
  });
  const passed = rows.filter((r) => r.status === "passed").length;
  return { rows, passed, total: rows.length, green: passed === rows.length && rows.length > 0 };
}

export function toMarkdown(summary, { title = "SpecLoop: spec coverage", evidenceUrl = "" } = {}) {
  const lines = [
    `## ${title}`,
    "",
    `**${summary.passed}/${summary.total} requirements verified by Kane CLI** ${summary.green ? "🟢" : "🔴"}`,
    "",
    "| Req | Requirement | Kane result |",
    "|---|---|---|",
  ];
  for (const r of summary.rows) {
    const why = r.res?.message ? ` — ${r.res.message.replace(/\|/g, "\\|").slice(0, 160)}` : "";
    lines.push(`| ${r.id} | ${r.title} | ${ICON[r.status] || "⚪"} ${r.status}${why} |`);
  }
  if (evidenceUrl) lines.push("", `Evidence (video + step trace): ${evidenceUrl}`);
  return lines.join("\n") + "\n";
}

// The prompt handed to a coding agent when requirements fail.
export function fixPrompt(summary) {
  const failing = summary.rows.filter((r) => r.status !== "passed");
  if (!failing.length) return "";
  const parts = [
    "Kane CLI ran the spec against the app in a real browser and these requirements FAILED.",
    "Fix the app in app/ so they pass. Do not edit spec.md or tests/ — the spec is the source of truth.",
    "",
  ];
  for (const r of failing) {
    parts.push(`### ${r.id}: ${r.title} (${r.status})`);
    parts.push("Expected behaviour (from spec.md):");
    for (const s of r.steps) parts.push(`- ${s}`);
    if (r.res?.message) {
      const step = Number.isInteger(r.res.stepIndex) ? ` at step ${r.res.stepIndex + 1}` : "";
      parts.push(`Kane failure${step}: ${r.res.message}`);
    }
    if (r.res?.logPath) parts.push(`Full Kane log: ${r.res.logPath}`);
    parts.push("");
  }
  parts.push("When you are done, SpecLoop will run Kane again to check your fix.");
  return parts.join("\n");
}
