#!/usr/bin/env node
// Fair scaffold benchmark: same model for every condition, equal information,
// automated pass/fail. Conditions:
//   raw       — one model call; gets the task + all relevant files inlined;
//               cannot run code or iterate.
//   caduceus  — the full agent (reads files, runs commands, verifies, iterates).
// Usage: node bench/run.mjs [taskId ...]   (default: all tasks)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CLI = join(REPO, "dist", "cli.js");
const TASKS_DIR = join(HERE, "tasks");

if (existsSync(join(REPO, ".env"))) process.loadEnvFile(join(REPO, ".env"));
const MODEL = process.env.CADUCEUS_MODEL || "qwen3-coder:480b-cloud";
const BASE = process.env.OLLAMA_BASE_URL || "https://ollama.com/v1";
const KEY = process.env.OLLAMA_API_KEY;

function loadTasks(filter) {
  return readdirSync(TASKS_DIR)
    .filter((d) => existsSync(join(TASKS_DIR, d, "spec.json")))
    .filter((d) => filter.length === 0 || filter.includes(d))
    .sort()
    .map((d) => ({ dir: join(TASKS_DIR, d), ...JSON.parse(readFileSync(join(TASKS_DIR, d, "spec.json"), "utf8")) }));
}

function setup(task) {
  const dir = mkdtempSync(join(tmpdir(), `bench-${task.id}-`));
  const ws = join(task.dir, "workspace");
  if (existsSync(ws)) cpSync(ws, dir, { recursive: true });
  return dir;
}

function verify(task, dir) {
  const r = spawnSync("bash", [join(task.dir, "verify.sh")], { cwd: dir, encoding: "utf8", timeout: 60000 });
  return r.status === 0;
}

function extractCode(text) {
  const blocks = [...text.matchAll(/```[a-zA-Z0-9._-]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const body = blocks.length ? blocks[blocks.length - 1] : text;
  return body.replace(/\s+$/, "") + "\n";
}

async function rawCall(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000); // a hung call = a failed run, not a stalled suite
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    const j = await res.json();
    return { content: j.choices?.[0]?.message?.content ?? "", tokens: j.usage?.total_tokens ?? null };
  } catch {
    return { content: "", tokens: null };
  } finally {
    clearTimeout(timer);
  }
}

async function runRaw(task) {
  const dir = setup(task);
  try {
    let ctx = "";
    for (const f of task.raw_context ?? []) {
      ctx += `\n\n--- ${f} ---\n${readFileSync(join(dir, f), "utf8")}`;
    }
    const prompt =
      `${task.prompt}\n\nYou cannot run code or use tools. ` +
      `Respond with ONLY the complete final content of the file \`${task.raw_output_file}\`, ` +
      `inside a single code fence.${ctx}`;
    const t0 = Date.now();
    const { content, tokens } = await rawCall(prompt);
    writeFileSync(join(dir, task.raw_output_file), extractCode(content));
    const pass = verify(task, dir);
    return { pass, tokens, secs: +((Date.now() - t0) / 1000).toFixed(1), steps: 1 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCaduceus(task) {
  const dir = setup(task);
  try {
    const t0 = Date.now();
    const r = spawnSync("node", [CLI, "--max-steps", "15", task.prompt], {
      cwd: dir,
      encoding: "utf8",
      timeout: 240000,
      env: { ...process.env, CADUCEUS_SANDBOX: "off", CADUCEUS_APPROVAL: "allow" },
    });
    const secs = +((Date.now() - t0) / 1000).toFixed(1);
    const tok = (r.stderr || "").match(/(\d+) tokens/);
    const stp = (r.stderr || "").match(/(\d+) steps/);
    const pass = verify(task, dir);
    return { pass, tokens: tok ? +tok[1] : null, steps: stp ? +stp[1] : null, secs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!KEY) throw new Error("OLLAMA_API_KEY missing (set it in .env)");
  const tasks = loadTasks(process.argv.slice(2));
  const rows = [];
  for (const task of tasks) {
    process.stderr.write(`\n[${task.id}] ${task.category}\n`);
    process.stderr.write("  raw      … ");
    const raw = await runRaw(task);
    process.stderr.write(`${raw.pass ? "PASS" : "fail"}  (${raw.tokens} tok, ${raw.secs}s)\n`);
    process.stderr.write("  caduceus … ");
    const cad = runCaduceus(task);
    process.stderr.write(`${cad.pass ? "PASS" : "fail"}  (${cad.tokens} tok, ${cad.steps} steps, ${cad.secs}s)\n`);
    rows.push({ id: task.id, category: task.category, raw, caduceus: cad });
  }

  // summary
  const tot = rows.length;
  const rawPass = rows.filter((r) => r.raw.pass).length;
  const cadPass = rows.filter((r) => r.caduceus.pass).length;
  process.stdout.write(`\n${"task".padEnd(20)} ${"category".padEnd(16)} raw  caduceus\n`);
  for (const r of rows) {
    process.stdout.write(
      `${r.id.padEnd(20)} ${r.category.padEnd(16)} ${(r.raw.pass ? "PASS" : "----").padEnd(4)} ${r.caduceus.pass ? "PASS" : "----"}\n`,
    );
  }
  process.stdout.write(`\nraw:      ${rawPass}/${tot}\ncaduceus: ${cadPass}/${tot}\n`);
  writeFileSync(join(HERE, "results.json"), JSON.stringify({ model: MODEL, tasks: rows }, null, 2));
  process.stdout.write(`\nresults written to bench/results.json\n`);
}

main().catch((e) => {
  process.stderr.write(`bench: ${e.message}\n`);
  process.exit(1);
});
