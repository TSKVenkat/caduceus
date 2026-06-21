#!/usr/bin/env node
// Honest measurement of tool-output compression in the loop. The agent must
// read a large prose file and report a single planted fact. We run it without
// and with LLMLingua compression of the (large) read_file output, and report
// real model-token usage AND whether the fact survived lossy compression.
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { run } from "../loop/orchestrator";
import { OllamaClient, type Usage } from "../model/ollama";
import { buildSystemPrompt } from "../prompt/system";
import { registerBuiltins } from "../tools/builtin";
import { ToolRegistry } from "../tools/registry";
import { LLMLinguaCompressor } from "./llmlingua";

const SECRET = "GLACIER-7731";
const TASK = "Read notes.txt and tell me the deployment passphrase. Report it exactly.";

function makeNotes(secret: string): string {
  const sentences = [
    "The team reviewed the quarterly infrastructure plan during the weekly sync.",
    "Latency improvements were prioritized over new feature work this cycle.",
    "The staging cluster was migrated to the new region without downtime.",
    "On-call rotations were adjusted to cover the upcoming release window.",
    "Cost dashboards showed a modest decline after the caching change.",
    "The data pipeline backfill completed ahead of the original schedule.",
    "Several flaky integration tests were quarantined pending investigation.",
    "Documentation for the ingestion service was updated by the platform team.",
    "A postmortem was scheduled for the brief authentication outage.",
    "The load test exercised the checkout path at twice peak traffic.",
  ];
  const paragraphs: string[] = [];
  for (let i = 0; i < 40; i++) {
    const para = Array.from({ length: 5 }, (_, j) => sentences[(i * 5 + j) % sentences.length]).join(" ");
    paragraphs.push(para);
    if (i === 20) {
      paragraphs.push(`Operational note: the deployment passphrase is ${secret}. Keep it confidential.`);
    }
  }
  return paragraphs.join("\n\n");
}

interface Outcome {
  pass: boolean;
  totalTokens: number;
  modelCalls: number;
  steps: number;
}

async function runOnce(
  config: ReturnType<typeof loadConfig>,
  workspace: string,
  compress: boolean,
): Promise<Outcome> {
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
  const compressor = compress ? new LLMLinguaCompressor() : undefined;

  try {
    const result = await run(TASK, {
      client,
      registry,
      cwd: workspace,
      systemPrompt: buildSystemPrompt({ registry }),
      maxSteps: 6,
      ...(compressor ? { compressor, compressMinChars: 1000, compressRate: 0.5 } : {}),
    });
    return {
      pass: result.finalText.includes(SECRET),
      totalTokens,
      modelCalls,
      steps: result.steps,
    };
  } finally {
    compressor?.close();
  }
}

async function main(): Promise<void> {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const config = loadConfig();
  const workspace = await mkdtemp(join(tmpdir(), "caduceus-measure-"));

  try {
    await writeFile(join(workspace, "notes.txt"), makeNotes(SECRET), "utf8");

    process.stderr.write("running WITHOUT compression...\n");
    const off = await runOnce(config, workspace, false);
    process.stderr.write("running WITH LLMLingua compression...\n");
    const on = await runOnce(config, workspace, true);

    const saved = off.totalTokens ? (1 - on.totalTokens / off.totalTokens) * 100 : 0;
    process.stdout.write(
      `\n${"condition".padEnd(14)} fact?  model-tokens  calls  steps\n` +
        `${"off".padEnd(14)} ${off.pass ? "yes" : "NO "}    ${String(off.totalTokens).padStart(8)}  ${String(off.modelCalls).padStart(5)}  ${String(off.steps).padStart(5)}\n` +
        `${"on (lingua)".padEnd(14)} ${on.pass ? "yes" : "NO "}    ${String(on.totalTokens).padStart(8)}  ${String(on.modelCalls).padStart(5)}  ${String(on.steps).padStart(5)}\n` +
        `\ntokens saved by compression: ${saved.toFixed(1)}%\n` +
        `fact preserved under compression: ${on.pass ? "YES" : "NO — compression dropped it"}\n`,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`measure: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
