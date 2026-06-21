import type { ContextFile } from "../context/files";
import type { OkfConcept } from "../knowledge/okf";
import type { EpisodicEntry } from "../memory/episodic";
import type { Skill } from "../skills/loader";
import type { ToolRegistry } from "../tools/registry";

export interface PromptInput {
  registry: ToolRegistry;
  skills?: Skill[];
  contextFiles?: ContextFile[];
  concepts?: OkfConcept[];
  memories?: EpisodicEntry[];
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
  const concepts = input.concepts ?? [];
  const memories = input.memories ?? [];
  const now = input.now ?? new Date();

  const sections: string[] = [];

  // Stable: identity and working principles.
  sections.push(
    [
      "You are Caduceus, an autonomous coding agent.",
      "",
      "Work the task to completion: inspect the workspace, make the necessary changes, and verify them with the available tools before you finish.",
      "Prefer small, reversible steps. Call one or more tools, read their results, then decide the next action.",
      "To change an existing file, use str_replace with a unique snippet — do not rewrite the whole file with write_file.",
      "When you need several independent pieces of information (e.g. reading multiple files), request them in a single turn rather than one at a time.",
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

  // Context: OKF knowledge catalog (Level 1 — read_concept loads bodies on demand).
  if (concepts.length > 0) {
    sections.push(
      [
        "## Knowledge (OKF)",
        "Curated knowledge about this workspace. Load a concept's full content with read_concept(id). Record durable new knowledge with write_concept and note notable changes with append_log.",
        concepts
          .map((concept) => {
            const summary = concept.description ? `: ${concept.description}` : "";
            return `- ${concept.id} (${concept.type})${summary}`;
          })
          .join("\n"),
      ].join("\n"),
    );
  }

  // Context: episodic memory catalog (titles only — recall() loads bodies on demand).
  if (memories.length > 0) {
    sections.push(
      [
        "## Memory (past lessons)",
        "Lessons learned on earlier tasks. Before a non-trivial task, call recall(query) to load relevant ones. After finishing, call remember(...) only for a durable, reusable lesson.",
        memories.map((m) => `- ${m.title} [${m.outcome}]${m.tags.length ? ` (${m.tags.join(", ")})` : ""}`).join("\n"),
      ].join("\n"),
    );
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
