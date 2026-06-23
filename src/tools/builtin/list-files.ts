import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool";
import { capture } from "./exec-capture";

const MAX_FILES = 300;
const FALLBACK_IGNORE = new Set([".git", "node_modules", "dist", ".caduceus", "coverage"]);

const schema = z.object({
  glob: z.string().optional().describe('Only list files matching this glob, e.g. "**/*.ts" or "*.json".'),
  path: z.string().optional().describe("Directory to list under (default: workspace root)."),
});

/**
 * List files in the workspace, optionally filtered by a glob. Uses ripgrep's
 * file walk (fast and gitignore-aware) and falls back to a manual recursive walk
 * when ripgrep isn't installed.
 */
export const listFilesTool = defineTool({
  name: "list_files",
  description:
    "List files in the workspace, optionally filtered by a glob pattern. Use this to discover files before reading or editing them.",
  schema,
  async execute({ glob, path }, ctx) {
    const target = path ?? ".";
    const rgArgs = ["--files"];
    if (glob) {
      rgArgs.push("--glob", glob);
    }
    rgArgs.push("--", target);

    const result = await capture("rg", rgArgs, ctx);
    let files: string[];

    if (result.notFound) {
      files = await walk(ctx.cwd, join(ctx.cwd, target), glob);
    } else {
      if (result.timedOut) {
        return "Listing timed out.";
      }
      if (result.code >= 2 && !result.stdout.trim()) {
        return `List error: ${result.stderr.trim() || `exit ${result.code}`}`;
      }
      files = result.stdout.split("\n").filter(Boolean);
    }

    files = files.map((f) => f.replace(/^\.\//, ""));
    if (files.length === 0) {
      return glob ? `No files match ${glob}.` : "No files found.";
    }
    files.sort();
    if (files.length > MAX_FILES) {
      return `${files.slice(0, MAX_FILES).join("\n")}\n\n[${files.length - MAX_FILES} more files truncated — narrow with a glob or path]`;
    }
    return files.join("\n");
  },
});

/** Recursive fallback walk (no ripgrep): skips common build/VCS dirs, applies the glob. */
async function walk(cwd: string, root: string, glob?: string): Promise<string[]> {
  const matcher = glob ? globToRegExp(glob) : null;
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && FALLBACK_IGNORE.has(entry.name)) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (FALLBACK_IGNORE.has(entry.name)) {
          continue;
        }
        await visit(full);
      } else if (entry.isFile()) {
        const rel = relative(cwd, full);
        if (!matcher || matcher.test(glob && !glob.includes("/") ? entry.name : rel)) {
          out.push(rel);
          if (out.length > MAX_FILES * 2) {
            return;
          }
        }
      }
    }
  }

  await visit(root);
  return out;
}

/** Minimal glob → RegExp supporting `**`, `*`, and `?`. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c ?? "")) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}
