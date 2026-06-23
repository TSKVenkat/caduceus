import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scrubbedEnv } from "../../exec/sandbox";
import type { ToolContext } from "../tool";

const run = promisify(execFile);

export interface CaptureResult {
  stdout: string;
  stderr: string;
  /** Process exit code (124 = timed out, 127 = binary not found). */
  code: number;
  /** The binary itself was missing (ENOENT) — caller can fall back. */
  notFound: boolean;
  timedOut: boolean;
}

/**
 * Run a binary and capture its output without throwing on a non-zero exit — many
 * search tools use exit code 1 to mean "no matches", which isn't an error here.
 * Honors the abort signal, scrubs secret-looking env vars, and bounds the buffer.
 */
export async function capture(
  file: string,
  args: string[],
  ctx: ToolContext,
  opts: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<CaptureResult> {
  try {
    const { stdout, stderr } = await run(file, args, {
      cwd: ctx.cwd,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
      env: scrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    return { stdout, stderr, code: 0, notFound: false, timedOut: false };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    if (e.code === "ENOENT") {
      return { stdout: "", stderr: "", code: 127, notFound: true, timedOut: false };
    }
    if (e.killed) {
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: 124, notFound: false, timedOut: true };
    }
    const code = typeof e.code === "number" ? e.code : 2;
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code, notFound: false, timedOut: false };
  }
}
