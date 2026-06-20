#!/usr/bin/env node
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "./config";
import { run, type RunEvent } from "./loop/orchestrator";
import { OllamaClient } from "./model/ollama";
import { registerBuiltins } from "./tools/builtin";
import { ToolRegistry } from "./tools/registry";

/** Load environment variables from a local .env file when present. */
function loadDotenv(): void {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
}

async function main(): Promise<void> {
  loadDotenv();

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string" },
      "max-steps": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const task = positionals.join(" ").trim();
  if (values.help || !task) {
    printUsage();
    process.exitCode = task ? 0 : 1;
    return;
  }

  const config = loadConfig({
    ...(values.model ? { model: values.model } : {}),
    ...(values["max-steps"] ? { maxSteps: Number(values["max-steps"]) } : {}),
  });

  const registry = new ToolRegistry();
  registerBuiltins(registry);

  const client = new OllamaClient(config);
  const result = await run(task, {
    client,
    registry,
    maxSteps: config.maxSteps,
    onEvent: renderEvent,
  });

  process.stdout.write(`\n${result.finalText}\n`);
  process.exitCode = result.stopReason === "done" ? 0 : 2;
}

function renderEvent(event: RunEvent): void {
  switch (event.type) {
    case "step":
      process.stderr.write(`\n[step ${event.n}]\n`);
      return;
    case "tool_call":
      process.stderr.write(`  → ${event.call.name}(${JSON.stringify(event.call.arguments)})\n`);
      return;
    case "tool_result":
      process.stderr.write(`  ${event.isError ? "✗" : "✓"} ${event.name}\n`);
      return;
    case "assistant":
      return;
  }
}

function printUsage(): void {
  process.stdout.write(
    [
      "Caduceus — an open coding agent on Ollama Cloud.",
      "",
      'Usage: caduceus [options] "<task>"',
      "",
      "Options:",
      "  --model <id>        Model to use (default: qwen3-coder:480b-cloud)",
      "  --max-steps <n>     Maximum loop iterations (default: 20)",
      "  -h, --help          Show this help",
      "",
      "Environment:",
      "  OLLAMA_API_KEY      Required. API key for Ollama Cloud.",
      "  OLLAMA_BASE_URL     Override the API base URL.",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`caduceus: ${message}\n`);
  process.exitCode = 1;
});
