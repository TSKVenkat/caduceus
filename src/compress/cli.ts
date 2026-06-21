#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { LLMLinguaCompressor } from "./llmlingua";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { rate: { type: "string" } },
  });

  const file = positionals[0];
  const text = file ? await readFile(file, "utf8") : await readStdin();
  if (!text.trim()) {
    process.stderr.write("usage: pnpm compress <file> [--rate 0.5]\n");
    process.exitCode = 1;
    return;
  }

  const rate = values.rate ? Number(values.rate) : 0.5;
  const compressor = new LLMLinguaCompressor();
  try {
    const result = await compressor.compress(text, { rate });
    const kept = result.originTokens ? (result.compressedTokens / result.originTokens) * 100 : 0;
    process.stderr.write(
      `\norigin tokens:     ${result.originTokens}\n` +
        `compressed tokens: ${result.compressedTokens}\n` +
        `kept ${kept.toFixed(1)}% (saved ${(100 - kept).toFixed(1)}%)\n\n`,
    );
    process.stdout.write(`${result.compressed}\n`);
  } finally {
    compressor.close();
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`compress: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
