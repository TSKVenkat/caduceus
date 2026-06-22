import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { defineTool, type Tool } from "../tools/tool";

/** A large file the agent can load on demand by id instead of inlining it. */
export interface Artifact {
  id: string;
  bytes: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024;

/** Catalog the artifacts directory (id = path relative to the store, plus size). */
export async function loadArtifacts(dir: string): Promise<Artifact[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const artifacts: Artifact[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const path = join(entry.parentPath, entry.name);
    artifacts.push({ id: relative(dir, path).split(sep).join("/"), bytes: (await stat(path)).size });
  }
  artifacts.sort((a, b) => a.id.localeCompare(b.id));
  return artifacts;
}

/** Tool to read an artifact's contents by id, with a traversal guard and size cap. */
export function createArtifactTool(dir: string): Tool {
  return defineTool({
    name: "load_artifact",
    description:
      "Load a large artifact's contents by id (see the artifacts catalog) instead of inlining it.",
    schema: z.object({
      id: z.string().min(1).describe("Artifact id from the catalog."),
      maxBytes: z.number().int().positive().optional(),
    }),
    async execute({ id, maxBytes }) {
      const target = resolve(dir, id);
      const root = resolve(dir);
      if (target !== root && !target.startsWith(root + sep)) {
        throw new Error(`artifact id escapes the store: ${id}`);
      }
      const limit = maxBytes ?? DEFAULT_MAX_BYTES;
      const contents = await readFile(target, "utf8");
      return contents.length <= limit ? contents : `${contents.slice(0, limit)}\n\n[truncated at ${limit} bytes]`;
    },
  });
}
