import type { ContextFile } from "../context/files";
import type { Skill } from "../skills/loader";
import type { ToolRegistry } from "../tools/registry";

export interface PromptInput {
  registry: ToolRegistry;
  skills?: Skill[];
  contextFiles?: ContextFile[];
  now?: Date;
}

/**
 * Assemble the system prompt in three tiers — stable, context, volatile — and in
 * that order so the long stable prefix stays cacheable and only the trailing
 * volatile block changes between runs.
 */
export function buildSystemPrompt(input: PromptInput): string {
  const { registry } = input;
  const skills = input.skills ?? [];
  const contextFiles = input.contextFiles ?? [];
  const now = input.now ?? new Date();

  const sections: string[] = [];

  // Stable: identity and working principles.
  sections.push(
    [
      "You are Caduceus, an autonomous coding agent.",
      "",
      "Work the task to completion: inspect the workspace, make the necessary changes, and verify them with the available tools before you finish.",
      "Prefer small, reversible steps. Call one or more tools, read their results, then decide the next action.",
      "Do not guess file contents — read them. Do not claim something works until you have verified it.",
      "When the task is complete, reply with a short summary and no tool call.",
    ].join("\n"),
  );

  // Stable: tool catalog.
  sections.push(["## Tools", toolLines(registry)].join("\n"));

  // Stable: skill catalog (Level 1 metadata only — bodies load on demand).
  if (skills.length > 0) {
    sections.push(
      [
        "## Skills",
        "Load a skill's full instructions with the load_skill tool when a task matches its description.",
        skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n"),
      ].join("\n"),
    );
  }

  // Context: project instruction files.
  for (const file of contextFiles) {
    sections.push([`## Project context: ${file.name}`, file.content].join("\n"));
  }

  // Volatile: kept last so the prefix above remains stable.
  sections.push(`Current time: ${now.toISOString()}`);

  return sections.join("\n\n");
}

function toolLines(registry: ToolRegistry): string {
  return registry
    .list()
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}
