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
  | { type: "tool_result"; name: string; content: string; isError: boolean };

export interface RunOptions {
  client: ModelClient;
  registry: ToolRegistry;
  maxSteps?: number;
  cwd?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
}

export interface RunResult {
  messages: Message[];
  steps: number;
  finalText: string;
  stopReason: StopReason;
}

/**
 * Bounded reason→act loop: the model either answers (done) or requests tools,
 * which we execute and feed back. Stops on completion, step budget, or a run of
 * consecutive tool errors.
 */
export async function run(task: string, options: RunOptions): Promise<RunResult> {
  const { client, registry } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const cwd = options.cwd ?? process.cwd();
  const emit = options.onEvent ?? noop;
  const tools = registry.specs();

  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt(registry) },
    { role: "user", content: task },
  ];

  let errorStreak = 0;

  for (let step = 1; step <= maxSteps; step++) {
    emit({ type: "step", n: step });

    const chatOptions = {
      tools,
      ...(options.signal ? { signal: options.signal } : {}),
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
      emit({ type: "tool_result", name: call.name, content: result.content, isError: result.isError });
      messages.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: result.content,
      });
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
