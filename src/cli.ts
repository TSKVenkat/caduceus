#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LLMLinguaCompressor } from "./compress/llmlingua";
import { loadConfig } from "./config";
import { Conversation } from "./engine/conversation";
import { buildSession } from "./engine/session";
import { type Approver, cliApprover, resolveApprovalMode } from "./exec/approval";
import { run } from "./loop/orchestrator";
import { OllamaClient } from "./model/ollama";
import { createRenderer } from "./ui/render";

/** Load environment variables from a local .env file when present. */
function loadDotenv(): void {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
}

async function main(): Promise<void> {
  loadDotenv();

  // `caduceus skills …` routes to the skills hub CLI before the normal task flow.
  if (process.argv[2] === "skills") {
    const { runSkillsCli } = await import("./cli-skills");
    process.exitCode = await runSkillsCli(process.argv.slice(3), {
      skillsDir: process.env.CADUCEUS_SKILLS_DIR ?? join(process.cwd(), "skills"),
    });
    return;
  }

  // `caduceus gateway …` routes to the gateway CLI.
  if (process.argv[2] === "gateway") {
    const { runGatewayCli } = await import("./gateway/cli.js");
    process.exitCode = await runGatewayCli(process.argv.slice(2));
    return;
  }

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string" },
      "max-steps": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printUsage();
    return;
  }

  const config = loadConfig({
    ...(values.model ? { model: values.model } : {}),
    ...(values["max-steps"] ? { maxSteps: Number(values["max-steps"]) } : {}),
  });

  const cwd = process.cwd();
  let totalTokens = 0;
  const client = new OllamaClient({
    ...config,
    onUsage: (usage) => {
      totalTokens += usage.totalTokens;
    },
  });
  const task = positionals.join(" ").trim();

  // No task: launch the interactive TUI in a terminal, otherwise show usage.
  if (!task) {
    if (!process.stdout.isTTY) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    const session = await buildSession({ cwd, client });
    try {
      const { runTui } = await import("./ui/tui");
      const makeConversation = (confirm?: Approver) =>
        new Conversation({
          client,
          registry: session.registry,
          systemPrompt: session.systemPrompt,
          maxSteps: config.maxSteps,
          ...(confirm ? { confirm } : {}),
        });
      await runTui({
        makeConversation,
        context: {
          registry: session.registry,
          cwd,
          skillsDir: process.env.CADUCEUS_SKILLS_DIR ?? join(cwd, "skills"),
          sessionDir: join(cwd, ".caduceus", "sessions"),
          model: config.model,
          usage: () => totalTokens,
        },
      });
    } finally {
      await session.close();
    }
    return;
  }

  // One-shot: run a single task and print the result.
  const session = await buildSession({ cwd, client });
  const { skills, contextFiles, concepts, memories, artifacts, mcpTools } = session.counts;
  process.stderr.write(
    `loaded ${skills} skill(s), ${contextFiles} context file(s), ${concepts} concept(s), ${memories} memory(ies), ${artifacts} artifact(s), ${mcpTools} MCP tool(s)\n`,
  );

  const streaming = process.env.CADUCEUS_STREAM === "1";
  const renderer = createRenderer();
  const compressor = process.env.CADUCEUS_COMPRESS === "1" ? new LLMLinguaCompressor() : undefined;
  const started = Date.now();
  try {
    const approver = cliApprover(resolveApprovalMode());
    const result = await run(task, {
      client,
      registry: session.registry,
      systemPrompt: session.systemPrompt,
      maxSteps: config.maxSteps,
      ...(approver ? { confirm: approver } : {}),
      onEvent: renderer.onEvent,
      ...(streaming ? { onToken: renderer.onToken } : {}),
      ...(compressor
        ? {
            compressor,
            compressMinChars: Number(process.env.CADUCEUS_COMPRESS_MIN_CHARS ?? 1500),
            compressRate: Number(process.env.CADUCEUS_COMPRESS_RATE ?? 0.5),
          }
        : {}),
    });
    renderer.finish();
    process.stdout.write(streaming ? "\n" : `\n${result.finalText}\n`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    process.stderr.write(`\n${totalTokens} tokens · ${seconds}s · ${result.steps} steps\n`);
    process.exitCode = result.stopReason === "done" ? 0 : 2;
  } finally {
    compressor?.close();
    await session.close();
  }
}

function printUsage(): void {
  process.stdout.write(
    [
      "Caduceus — an open coding agent on Ollama Cloud.",
      "",
      "Usage:",
      '  caduceus "<task>"     Run a single task',
      "  caduceus              Start the interactive TUI (in a terminal)",
      "",
      "Options:",
      "  --model <id>          Model to use (default: qwen3-coder:480b-cloud)",
      "  --max-steps <n>       Maximum loop iterations (default: 20)",
      "  -h, --help            Show this help",
      "",
      "Environment:",
      "  OLLAMA_API_KEY        Required. API key for Ollama Cloud.",
      "  OLLAMA_BASE_URL       Override the API base URL.",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`caduceus: ${message}\n`);
  process.exitCode = 1;
});
