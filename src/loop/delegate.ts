import { z } from "zod";
import type { ModelClient } from "../model/client";
import { buildSystemPrompt } from "../prompt/system";
import { registerBuiltins } from "../tools/builtin";
import { ToolRegistry } from "../tools/registry";
import { defineTool, type Tool } from "../tools/tool";
import { run } from "./orchestrator";

export interface DelegateDeps {
  client: ModelClient;
  cwd: string;
  /** Per-subagent step budget. */
  maxSteps?: number;
  /** Max subagents run at once (and the cap on tasks per call). */
  maxConcurrency?: number;
}

/**
 * Delegate independent subtasks to isolated subagents. Each subagent gets a fresh
 * context and only the builtin tools (no delegate — so no nesting), runs under a
 * bounded budget, and returns a compact digest. Per the evidence, this helps for
 * parallel/independent investigation, not for sequential or same-file edits.
 */
export function createDelegateTool(deps: DelegateDeps): Tool {
  const maxSteps = deps.maxSteps ?? 10;
  const maxConcurrency = deps.maxConcurrency ?? 4;

  return defineTool({
    name: "delegate",
    description:
      "Delegate up to a few INDEPENDENT investigation subtasks to isolated subagents (each with its own context) and get back a concise digest of their findings. Use for parallel read-only exploration or bounded subtasks — not for edits to the same file or sequential work. Subagents cannot delegate further.",
    schema: z.object({
      tasks: z
        .array(z.string().min(1))
        .min(1)
        .max(maxConcurrency)
        .describe("Independent subtasks; each runs in its own subagent."),
    }),
    async execute({ tasks }, ctx) {
      const digests = await runWithLimit(tasks, maxConcurrency, async (task) => {
        const registry = new ToolRegistry();
        registerBuiltins(registry);
        const result = await run(task, {
          client: deps.client,
          registry,
          cwd: deps.cwd,
          systemPrompt: buildSystemPrompt({ registry }),
          maxSteps,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return `### ${task}\n${result.finalText.trim()}\n_(subagent: ${result.steps} steps, ${result.stopReason})_`;
      });
      return digests.join("\n\n");
    },
  });
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}
