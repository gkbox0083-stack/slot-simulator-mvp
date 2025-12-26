#!/usr/bin/env node
/**
 * v1.5.0 Acceptance Verifier (v2)
 *
 * Hard gates:
 * - Shadow columns exist (P0-8)
 * - No evaluationMatch=false for payout>0 (P0-3)
 * - evaluatedEventCount <= 1 (P0-4)
 *
 * Added static guards (regex-based):
 * - `.evaluate(` call exists ONLY in simulate.js (P0-2/P0-6)
 * - visualConstraint does not reference evaluator (P0-2)
 * - visualConstraint protectedCells derivation prioritizes winEvents.positions (P0-5)
 */

const fs = require("fs");
const path = require("path");

function fail(msg) {
  console.error("❌ FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("✅", msg);
}

function exists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function listJsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsFiles(full));
    else if (e.isFile() && e.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Minimal CSV parsing (quoted fields supported)
function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(cur); cur = "";
    } else cur += ch;
  }
  result.push(cur);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cols[j] ?? "";
    rows.push(row);
  }
  return { header, rows };
}

function findRepoRoot(start = process.cwd()) {
  if (exists(path.join(start, "logic"))) return start;
  const parent = path.dirname(start);
  if (parent !== start) return findRepoRoot(parent);
  return start;
}

function extractFunctionBlock(fileText, name) {
  const idx = fileText.indexOf(name);
  if (idx === -1) return null;
  const braceStart = fileText.indexOf("{", idx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < fileText.length; i++) {
    const ch = fileText[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) return fileText.slice(idx, i + 1);
  }
  return null;
}

function indexOfAny(text, needles) {
  let best = -1;
  for (const n of needles) {
    const i = text.indexOf(n);
    if (i !== -1) best = best === -1 ? i : Math.min(best, i);
  }
  return best;
}

function runStaticGuards(repoRoot) {
  const logicDir = path.join(repoRoot, "logic");
  if (!exists(logicDir)) { fail(`Cannot find logic/ at ${logicDir}`); return; }

  const jsFiles = listJsFiles(logicDir);
  const rel = (p) => path.relative(repoRoot, p).replaceAll("\\", "/");

  const simulateFile = jsFiles.find(f => f.endsWith("simulate.js"));
  const visualFile = jsFiles.find(f => f.endsWith("visualConstraint.js"));
  const resolverFile = jsFiles.find(f => f.endsWith("resolver.js"));

  if (!simulateFile) fail("Missing logic/simulate.js");
  else ok("Found simulate.js");

  if (!visualFile) fail("Missing logic/visualConstraint.js");
  else ok("Found visualConstraint.js");

  // `.evaluate(` must only be in simulate.js
  const evalRe = /\.evaluate\s*\(/g;
  const offenders = [];
  for (const f of jsFiles) {
    const t = readText(f);
    if (evalRe.test(t) && f !== simulateFile) offenders.push(rel(f));
  }
  if (offenders.length) {
    fail(`Single Evaluation Point violated (.evaluate found outside simulate.js):\n- ${offenders.join("\n- ")}`);
  } else ok("P0-2/P0-6: .evaluate only in simulate.js");

  // visualConstraint must not reference evaluator
  const vt = readText(visualFile);
  const hints = ["payRuleEvaluator", "PayRuleEvaluator", "require('./payRuleEvaluator", "require(\"./payRuleEvaluator"];
  const found = hints.filter(h => vt.includes(h));
  if (found.length) fail(`visualConstraint.js references evaluator (${found.join(", ")}). Forbidden.`);
  else ok("P0-2: visualConstraint.js does not reference evaluator");

  // protectedCells priority: positions before legacy
  const derive = extractFunctionBlock(vt, "_deriveProtectedCells");
  if (!derive) fail("P0-5: Missing _deriveProtectedCells");
  else {
    const posIdx = indexOfAny(derive, ["positions", "winEvents"]);
    const legacyIdx = indexOfAny(derive, ["legacyWinLine", "winLine"]);
    if (posIdx === -1 || legacyIdx === -1) fail("P0-5: _deriveProtectedCells must include winEvents.positions and legacy fallback");
    else if (posIdx > legacyIdx) fail("P0-5: _deriveProtectedCells checks legacy before winEvents.positions (wrong order)");
    else ok("P0-5: protectedCells priority looks correct (winEvents.positions first)");
  }

  const apply = extractFunctionBlock(vt, "applyConstraints");
  if (!apply) fail("P0-5: Missing applyConstraints");
  else if (!apply.includes("winEvents")) fail("P0-5: applyConstraints must accept winEvents param");
  else ok("P0-5: applyConstraints accepts winEvents");

  if (resolverFile) {
    const rt = readText(resolverFile);
    if (rt.includes("payRuleEvaluator") || rt.includes("PayRuleEvaluator")) fail("P0-6: resolver.js references evaluator (forbidden)");
    else ok("P0-6: resolver.js does not reference evaluator");
  } else {
    console.warn("⚠️ resolver.js not found; skip resolver static guard");
  }
}

function runCsvChecks(repoRoot) {
  const csvPath = path.join(repoRoot, "result.csv");
  if (!exists(csvPath)) { fail(`Missing result.csv at ${csvPath}. Run: node logic/cli.js -n 10000 --csv`); return; }
  ok("Found result.csv");

  const csv = parseCsv(readText(csvPath));
  const headerSet = new Set(csv.header);

  const requiredCols = ["expectedWinAmount","evaluatedWinAmount","evaluationMatch","evaluatedEventCount","evaluatedRuleTypes","eventsJson"];
  const missing = requiredCols.filter(c => !headerSet.has(c));
  if (missing.length) fail(`P0-8: Missing shadow columns: ${missing.join(", ")}`);
  else ok("P0-8: Shadow columns exist");

  let multi = 0;
  for (const r of csv.rows) {
    const n = Number(r.evaluatedEventCount ?? "0");
    if (Number.isFinite(n) && n > 1) multi++;
  }
  if (multi) fail(`P0-4: Found ${multi} rows with evaluatedEventCount>1`);
  else ok("P0-4: evaluatedEventCount<=1 holds");

  let mismatch = 0, pos = 0;
  for (const r of csv.rows) {
    const expected = Number(r.expectedWinAmount ?? "0");
    const match = String(r.evaluationMatch ?? "").toLowerCase();
    if (Number.isFinite(expected) && expected > 0) {
      pos++;
      if (match === "false") mismatch++;
    }
  }
  if (mismatch) fail(`P0-3: Found ${mismatch}/${pos} payout>0 rows with evaluationMatch=false`);
  else ok(`P0-3: evaluationMatch=false=0 over payout>0 rows (${pos})`);
}

function main() {
  console.log("============================================================");
  console.log("v1.5.0 Acceptance Verifier (v2)");
  console.log("============================================================");

  const repoRoot = findRepoRoot();
  console.log("Repo root:", repoRoot);

  runStaticGuards(repoRoot);
  runCsvChecks(repoRoot);

  if (process.exitCode === 1) {
    console.error("\n❌ Verification FAILED.");
  } else {
    console.log("\n✅ Verification PASSED.");
  }
}

main();
