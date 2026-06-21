import { z } from "zod";
import { defineTool, type Tool } from "../tools/tool";
import { appendLog, isValidConceptId, readConcept, writeConcept } from "./okf";

const conceptId = z
  .string()
  .min(1)
  .refine(isValidConceptId, "must be a bundle-relative path with no '..' segments");

/**
 * Tools for an OKF knowledge bundle: read concepts on demand (Level-2 disclosure),
 * and author durable knowledge back into the bundle (the LLM-wiki pattern).
 */
export function createKnowledgeTools(bundleDir: string): Tool[] {
  return [readConceptTool(bundleDir), writeConceptTool(bundleDir), appendLogTool(bundleDir)];
}

function readConceptTool(bundleDir: string): Tool {
  return defineTool({
    name: "read_concept",
    description: "Read a knowledge concept's full content by id (e.g. tables/orders).",
    schema: z.object({ id: conceptId.describe("Concept id from the knowledge catalog.") }),
    async execute({ id }) {
      try {
        return await readConcept(bundleDir, id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Concept not found: ${id}`);
        }
        throw error;
      }
    },
  });
}

function writeConceptTool(bundleDir: string): Tool {
  return defineTool({
    name: "write_concept",
    description:
      "Create or update a knowledge concept (durable facts about this workspace). Writes an OKF document.",
    schema: z.object({
      id: conceptId.describe("Bundle-relative id, e.g. architecture/agent-loop."),
      type: z.string().min(1).describe("Concept kind, e.g. Architecture, Table, Runbook."),
      title: z.string().optional(),
      description: z.string().optional().describe("One-sentence summary for the catalog."),
      resource: z.string().optional().describe("URI of the underlying asset, if any."),
      tags: z.array(z.string()).optional(),
      body: z.string().min(1).describe("Markdown body; prefer headings, lists, and tables."),
    }),
    async execute(input) {
      const id = await writeConcept(bundleDir, input, new Date());
      return `Wrote concept ${id}`;
    },
  });
}

function appendLogTool(bundleDir: string): Tool {
  return defineTool({
    name: "append_log",
    description: "Record a notable change or learning in the knowledge log (log.md), newest first.",
    schema: z.object({ entry: z.string().min(1).describe("One-line log entry.") }),
    async execute({ entry }) {
      await appendLog(bundleDir, entry, new Date());
      return "Logged.";
    },
  });
}
