import type { ModelClient } from "../model/client";
import { buildSystemPrompt } from "../prompt/system";
import { ToolArgsError } from "../tools/tool";
import type { ToolRegistry } from "../tools/registry";
import type { Message, ToolCall } from "../types";

const DEFAULT_MAX_STEPS = 20;
const ERROR_STREAK_LIMIT = 3;

export type StopReason = "done" | "max_steps" | "circuit_breaker";

export type RunEvent =
  | { type: "step"; n: number }
  | { type: "assistant"; content: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; name: string; content: string; isError: boolean }
  | { type: "compress"; tool: string; beforeTokens: number; afterTokens: number };

/** Compresses large tool output before it enters the message history. */
export interface ToolOutputCompressor {
  compress(
    text: string,
    options: { rate?: number },
  ): Promise<{ compressed: string; originTokens: number; compressedTokens: number }>;
}

export interface RunOptions {
  client: ModelClient;
  registry: ToolRegistry;
  /** Prebuilt system prompt; falls back to a minimal prompt from the registry. */
  systemPrompt?: string;
  maxSteps?: number;
  cwd?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /** Stream assistant text deltas live (forwarded to the model client). */
  onToken?: (text: string) => void;
  /** When set, tool output at/above `compressMinChars` is compressed (lossy). */
  compressor?: ToolOutputCompressor;
  compressMinChars?: number;
  compressRate?: number;
}

export interface RunResult {
  messages: Message[];
  steps: number;
  finalText: string;
  stopReason: StopReason;
}

/**
 * One-shot entry point: seed a fresh conversation ([system, user]) and run a
 * single turn to completion. Kept as a convenience over {@link runTurn}.
 */
export async function run(task: string, options: RunOptions): Promise<RunResult> {
  const systemPrompt = options.systemPrompt ?? buildSystemPrompt({ registry: options.registry });
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];
  return runTurn(messages, options);
}

/**
 * Run the bounded reason→act loop over a pre-seeded message history (which must
 * already include the system prompt and the latest user message). The model
 * either answers (done) or requests tools, which we execute and feed back.
 * Mutates and returns `messages`, so a Conversation can keep it across turns.
 */
export async function runTurn(messages: Message[], options: RunOptions): Promise<RunResult> {
  const { client, registry } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const cwd = options.cwd ?? process.cwd();
  const emit = options.onEvent ?? noop;
  const compressMinChars = options.compressMinChars ?? 1500;
  const compressRate = options.compressRate ?? 0.5;
  const tools = registry.specs();

  let errorStreak = 0;

  for (let step = 1; step <= maxSteps; step++) {
    emit({ type: "step", n: step });

    const chatOptions = {
      tools,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onToken ? { onToken: options.onToken } : {}),
    };
    const reply = await client.chat(messages, chatOptions);
    messages.push(reply);

    if (!reply.toolCalls?.length) {
      emit({ type: "assistant", content: reply.content });
      return { messages, steps: step, finalText: reply.content, stopReason: "done" };
    }

    let stepHadError = false;
    for (const call of reply.toolCalls) {
      emit({ type: "tool_call", call });
      const result = await runTool(call, registry, { cwd, ...(options.signal ? { signal: options.signal } : {}) });
      stepHadError ||= result.isError;

      let content = result.content;
      if (options.compressor && !result.isError && content.length >= compressMinChars) {
        try {
          const compressed = await options.compressor.compress(content, { rate: compressRate });
          if (compressed.compressedTokens < compressed.originTokens) {
            emit({
              type: "compress",
              tool: call.name,
              beforeTokens: compressed.originTokens,
              afterTokens: compressed.compressedTokens,
            });
            content = compressed.compressed;
          }
        } catch {
          // fail open: keep the original output if compression errors
        }
      }

      emit({ type: "tool_result", name: call.name, content, isError: result.isError });
      messages.push({ role: "tool", name: call.name, toolCallId: call.id, content });
    }

    errorStreak = stepHadError ? errorStreak + 1 : 0;
    if (errorStreak >= ERROR_STREAK_LIMIT) {
      return {
        messages,
        steps: step,
        finalText: `Stopped after ${ERROR_STREAK_LIMIT} consecutive tool failures.`,
        stopReason: "circuit_breaker",
      };
    }
  }

  return {
    messages,
    steps: maxSteps,
    finalText: "Stopped: step budget exhausted before the task completed.",
    stopReason: "max_steps",
  };
}

interface ToolOutcome {
  content: string;
  isError: boolean;
}

async function runTool(
  call: ToolCall,
  registry: ToolRegistry,
  ctx: { cwd: string; signal?: AbortSignal },
): Promise<ToolOutcome> {
  const tool = registry.get(call.name);
  if (!tool) {
    return { content: `Unknown tool: ${call.name}`, isError: true };
  }

  try {
    const content = await tool.run(call.arguments, ctx);
    return { content, isError: false };
  } catch (error) {
    if (error instanceof ToolArgsError) {
      return { content: `Invalid arguments: ${error.message}`, isError: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { content: `Error: ${message}`, isError: true };
  }
}

function noop(): void {}
