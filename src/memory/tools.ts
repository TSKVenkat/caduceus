import { z } from "zod";
import { defineTool, type Tool } from "../tools/tool";
import { searchEpisodic, writeEntry } from "./episodic";

const MAX_RECALL_CHARS = 4000;

/**
 * Episodic memory tools. `remember` is intentionally strict: the evidence is that
 * indiscriminate writes degrade an agent (it imitates whatever is stored), so the
 * description constrains writes to durable, reusable lessons and storage dedupes
 * by title.
 */
export function createMemoryTools(dir: string): Tool[] {
  return [rememberTool(dir), recallTool(dir)];
}

function rememberTool(dir: string): Tool {
  return defineTool({
    name: "remember",
    description:
      "Record ONE durable, reusable lesson from this task (a gotcha, a fix pattern, a project fact worth recalling next time). Do NOT log routine steps, one-off details, or anything you are unsure about — low-quality memories make future runs worse.",
    schema: z.object({
      title: z.string().min(1).describe("Short, specific title (acts as the dedupe key)."),
      lesson: z.string().min(1).describe("The reusable lesson, in a few sentences."),
      outcome: z.enum(["success", "failure", "note"]).optional(),
      tags: z.array(z.string()).optional(),
    }),
    async execute(input) {
      const slug = await writeEntry(dir, input, new Date());
      return `Remembered: ${slug}`;
    },
  });
}

function recallTool(dir: string): Tool {
  return defineTool({
    name: "recall",
    description:
      "Search past lessons relevant to the current task and return the most relevant ones. Call this before tackling a non-trivial task.",
    schema: z.object({
      query: z.string().min(1).describe("What you're about to do or are stuck on."),
      limit: z.number().int().positive().max(10).optional(),
    }),
    async execute({ query, limit }) {
      const hits = await searchEpisodic(dir, query, limit ?? 3);
      if (hits.length === 0) {
        return "No relevant memories.";
      }
      let out = "";
      for (const hit of hits) {
        const block = `## ${hit.entry.title} [${hit.entry.outcome}]\n${hit.body}\n\n`;
        if (out.length + block.length > MAX_RECALL_CHARS) {
          break;
        }
        out += block;
      }
      return out.trim();
    },
  });
}
