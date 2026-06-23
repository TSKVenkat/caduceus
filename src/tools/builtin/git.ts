import { z } from "zod";
import { defineTool } from "../tool";
import { capture, type CaptureResult } from "./exec-capture";

const MAX_DIFF_LINES = 400;

function notRepo(result: CaptureResult): boolean {
  return result.code !== 0 && /not a git repository/i.test(result.stderr);
}

const statusTool = defineTool({
  name: "git_status",
  description: "Show the working tree status (branch and changed files), like `git status --short --branch`.",
  schema: z.object({}),
  async execute(_args, ctx) {
    const result = await capture("git", ["status", "--short", "--branch"], ctx);
    if (result.notFound) {
      return "git is not installed.";
    }
    if (notRepo(result)) {
      return "Not a git repository.";
    }
    if (result.code !== 0) {
      return `git error: ${result.stderr.trim() || `exit ${result.code}`}`;
    }
    const output = result.stdout.trimEnd();
    // With --branch there is always a header line; a clean tree has only that.
    return output.split("\n").length <= 1 ? `${output}\n(working tree clean)` : output;
  },
});

const diffTool = defineTool({
  name: "git_diff",
  description:
    "Show changes as a unified diff. By default shows unstaged changes; set staged to see staged changes, or stat for a summary.",
  schema: z.object({
    staged: z.boolean().optional().describe("Show staged changes (git diff --cached)."),
    stat: z.boolean().optional().describe("Show a diffstat summary instead of the full diff."),
    path: z.string().optional().describe("Limit the diff to a file or directory."),
  }),
  async execute({ staged, stat, path }, ctx) {
    const args = ["diff", "--no-color"];
    if (staged) {
      args.push("--cached");
    }
    if (stat) {
      args.push("--stat");
    }
    if (path) {
      args.push("--", path);
    }

    const result = await capture("git", args, ctx);
    if (result.notFound) {
      return "git is not installed.";
    }
    if (notRepo(result)) {
      return "Not a git repository.";
    }
    if (result.code !== 0) {
      return `git error: ${result.stderr.trim() || `exit ${result.code}`}`;
    }

    const output = result.stdout.trimEnd();
    if (!output) {
      return staged ? "No staged changes." : "No unstaged changes.";
    }
    const lines = output.split("\n");
    if (lines.length > MAX_DIFF_LINES) {
      return `${lines.slice(0, MAX_DIFF_LINES).join("\n")}\n\n[diff truncated at ${MAX_DIFF_LINES} lines — narrow with a path, or use stat]`;
    }
    return output;
  },
});

export const gitTools = [statusTool, diffTool];
