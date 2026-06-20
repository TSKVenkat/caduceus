import type { ToolRegistry } from "../tools/registry";

/**
 * Builds the system prompt. This is the stable tier: identity and tool guidance
 * that stay fixed for the whole run so the prefix stays cache-friendly.
 */
export function buildSystemPrompt(registry: ToolRegistry): string {
  const tools = registry
    .list()
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  return [
    "You are Caduceus, an autonomous coding agent.",
    "",
    "Work the task to completion: inspect the workspace, make the necessary changes, and verify them with the available tools before you finish.",
    "Prefer small, reversible steps. Call one or more tools, read their results, then decide the next action.",
    "Do not guess file contents — read them. Do not claim something works until you have verified it.",
    "When the task is complete, reply with a short summary and no tool call.",
    "",
    "Available tools:",
    tools,
  ].join("\n");
}
