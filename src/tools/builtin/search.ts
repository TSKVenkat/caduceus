import { z } from "zod";
import { defineTool } from "../tool";
import { capture } from "./exec-capture";

const MAX_LINES = 200;

const schema = z.object({
  pattern: z.string().min(1).describe("Regular expression to search for."),
  path: z.string().optional().describe("File or directory to search (default: workspace root)."),
  glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts" or "src/**/*.js".'),
  ignoreCase: z.boolean().optional().describe("Case-insensitive search."),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Lines of context to show around each match."),
});

/**
 * Code search across the workspace. Uses ripgrep (fast, gitignore-aware) and
 * falls back to grep when ripgrep isn't installed. Returns `file:line:match`
 * lines, capped so a broad pattern can't flood the context window.
 */
export const searchCodeTool = defineTool({
  name: "search_code",
  description:
    "Search file contents for a regular expression and return matching file:line results. Prefer this over `bash` with grep for finding code.",
  schema,
  async execute({ pattern, path, glob, ignoreCase, contextLines }, ctx) {
    const target = path ?? ".";
    const rgArgs = ["--line-number", "--no-heading", "--color=never", "--max-columns=300", "--no-messages"];
    if (ignoreCase) {
      rgArgs.push("--ignore-case");
    }
    if (contextLines) {
      rgArgs.push("--context", String(contextLines));
    }
    if (glob) {
      rgArgs.push("--glob", glob);
    }
    rgArgs.push("--regexp", pattern, "--", target);

    let result = await capture("rg", rgArgs, ctx);

    if (result.notFound) {
      const grepArgs = ["-rnE"];
      if (ignoreCase) {
        grepArgs.push("-i");
      }
      if (contextLines) {
        grepArgs.push("-C", String(contextLines));
      }
      if (glob) {
        grepArgs.push(`--include=${glob}`);
      }
      grepArgs.push("--", pattern, target);
      result = await capture("grep", grepArgs, ctx);
    }

    if (result.timedOut) {
      return "Search timed out.";
    }
    const output = result.stdout.trimEnd();
    if (result.code === 1 && !output) {
      return "No matches found.";
    }
    if (result.code >= 2 && !output) {
      return `Search error: ${result.stderr.trim() || `exit ${result.code}`}`;
    }

    const lines = output.split("\n");
    if (lines.length > MAX_LINES) {
      return `${lines.slice(0, MAX_LINES).join("\n")}\n\n[${lines.length - MAX_LINES} more matching lines truncated — narrow the pattern or set a path/glob]`;
    }
    return output;
  },
});
