import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** A project instruction file loaded into the context tier of the prompt. */
export interface ContextFile {
  name: string;
  content: string;
}

/** Instruction files recognized in the workspace root, in priority order. */
const CONTEXT_FILENAMES = ["AGENTS.md", "CLAUDE.md", ".cursorrules"];

/** Load any recognized instruction files present in the workspace root. */
export async function loadContextFiles(cwd: string): Promise<ContextFile[]> {
  const files: ContextFile[] = [];
  for (const name of CONTEXT_FILENAMES) {
    const path = join(cwd, name);
    if (!existsSync(path)) {
      continue;
    }
    const content = (await readFile(path, "utf8")).trim();
    if (content) {
      files.push({ name, content });
    }
  }
  return files;
}
