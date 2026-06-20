import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../tool";

const run = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_RENDERED_CHARS = 16_000;

const schema = z.object({
  command: z.string().min(1).describe("Shell command executed via `bash -c`."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`),
});

export const bashTool = defineTool({
  name: "bash",
  description: "Run a shell command in the workspace and return its combined output.",
  schema,
  async execute({ command, timeoutMs }, ctx) {
    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const { stdout, stderr } = await run("bash", ["-c", command], {
        cwd: ctx.cwd,
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      return render(stdout, stderr, 0);
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };
      if (failure.killed) {
        return `Command timed out after ${timeout}ms`;
      }
      const exitCode = typeof failure.code === "number" ? failure.code : 1;
      return render(failure.stdout ?? "", failure.stderr ?? "", exitCode);
    }
  },
});

function render(stdout: string, stderr: string, exitCode: number): string {
  const sections = [`exit code: ${exitCode}`];
  if (stdout.trim()) {
    sections.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.trim()) {
    sections.push(`stderr:\n${stderr.trimEnd()}`);
  }
  const output = sections.join("\n\n");
  return output.length > MAX_RENDERED_CHARS
    ? `${output.slice(0, MAX_RENDERED_CHARS)}\n\n[output truncated]`
    : output;
}
