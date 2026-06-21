import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { loadConfig } from "../src/config";
import { run } from "../src/loop/orchestrator";
import { OllamaClient, type Usage } from "../src/model/ollama";
import { buildSystemPrompt } from "../src/prompt/system";
import { registerBuiltins } from "../src/tools/builtin";
import { ToolRegistry } from "../src/tools/registry";

const exec = promisify(execFile);
const TASKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "tasks");
const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "results");

interface AttemptResult {
  taskId: string;
  attempt: number;
  pass: boolean;
  steps: number;
  stopReason: string;
  seconds: number;
  modelCalls: number;
  totalTokens: number;
}

async function main(): Promise<void> {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }

  const { values } = parseArgs({
    options: {
      attempts: { type: "string" },
      "max-steps": { type: "string" },
      task: { type: "string" },
      model: { type: "string" },
    },
  });

  const attempts = values.attempts ? Number(values.attempts) : 1;
  const config = loadConfig({
    ...(values.model ? { model: values.model } : {}),
    ...(values["max-steps"] ? { maxSteps: Number(values["max-steps"]) } : {}),
  });

  const taskIds = (await readdir(TASKS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => !values.task || id === values.task)
    .sort();

  if (taskIds.length === 0) {
    throw new Error(values.task ? `No task named ${values.task}` : "No tasks found");
  }

  process.stderr.write(
    `Running ${taskIds.length} task(s) x ${attempts} attempt(s) on ${config.model}\n\n`,
  );

  const results: AttemptResult[] = [];
  for (const taskId of taskIds) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await runTask(taskId, attempt, config);
      results.push(result);
      process.stderr.write(
        `  ${result.pass ? "PASS" : "FAIL"}  ${taskId} #${attempt}  ` +
          `(${result.steps} steps, ${result.seconds.toFixed(1)}s, ${result.modelCalls} calls, ${result.totalTokens} tok, ${result.stopReason})\n`,
      );
    }
  }

  await report(results, config.model, attempts);
}

async function runTask(taskId: string, attempt: number, config: ReturnType<typeof loadConfig>): Promise<AttemptResult> {
  const taskDir = join(TASKS_DIR, taskId);
  const prompt = (await readFile(join(taskDir, "prompt.txt"), "utf8")).trim();
  const workspace = await mkdtemp(join(tmpdir(), `caduceus-eval-${taskId}-`));

  try {
    await cp(join(taskDir, "workspace"), workspace, { recursive: true });

    let totalTokens = 0;
    let modelCalls = 0;
    const client = new OllamaClient({
      ...config,
      onUsage: (usage: Usage) => {
        totalTokens += usage.totalTokens;
        modelCalls += 1;
      },
    });

    const registry = new ToolRegistry();
    registerBuiltins(registry);

    const start = Date.now();
    const result = await run(prompt, {
      client,
      registry,
      cwd: workspace,
      systemPrompt: buildSystemPrompt({ registry }),
      maxSteps: config.maxSteps,
      maxContextTokens: config.maxContextTokens,
      keepRecent: config.keepRecent,
    });
    const seconds = (Date.now() - start) / 1000;

    const pass = await verify(taskDir, workspace);

    return {
      taskId,
      attempt,
      pass,
      steps: result.steps,
      stopReason: result.stopReason,
      seconds,
      modelCalls,
      totalTokens,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function verify(taskDir: string, workspace: string): Promise<boolean> {
  try {
    await exec("bash", [join(taskDir, "verify.sh")], { cwd: workspace, timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

async function report(results: AttemptResult[], model: string, attempts: number): Promise<void> {
  const taskIds = [...new Set(results.map((r) => r.taskId))];
  const passed = results.filter((r) => r.pass).length;
  const resolveRate = passed / results.length;

  process.stdout.write(`\nBaseline — ${model}\n`);
  process.stdout.write(`${"task".padEnd(22)} pass  steps  secs   tokens\n`);
  for (const taskId of taskIds) {
    const rows = results.filter((r) => r.taskId === taskId);
    const p = rows.filter((r) => r.pass).length;
    const avg = (pick: (r: AttemptResult) => number) =>
      rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;
    process.stdout.write(
      `${taskId.padEnd(22)} ${p}/${rows.length}   ${avg((r) => r.steps).toFixed(1).padStart(4)}  ` +
        `${avg((r) => r.seconds).toFixed(1).padStart(5)}  ${Math.round(avg((r) => r.totalTokens)).toString().padStart(6)}\n`,
    );
  }
  process.stdout.write(
    `\nResolve rate: ${passed}/${results.length} = ${(resolveRate * 100).toFixed(1)}%  ` +
      `(${taskIds.length} tasks x ${attempts} attempts)\n`,
  );

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = join(RESULTS_DIR, "latest.json");
  await writeFile(out, JSON.stringify({ model, attempts, resolveRate, results }, null, 2), "utf8");
  process.stdout.write(`\nWrote ${out}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`eval: ${message}\n`);
  process.exitCode = 1;
});
