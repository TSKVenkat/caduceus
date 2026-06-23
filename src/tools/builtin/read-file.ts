import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool";

const DEFAULT_MAX_BYTES = 64 * 1024;

const schema = z.object({
  path: z.string().min(1).describe("File path, absolute or relative to the working directory."),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based line number to start reading from (use with `limit` to read a slice of a large file)."),
  limit: z.number().int().positive().optional().describe("Maximum number of lines to read from `offset`."),
  lineNumbers: z
    .boolean()
    .optional()
    .describe("Prefix each line with its 1-based number. Do not copy these prefixes into edit tools."),
  maxBytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Maximum bytes to read when no line range is given (default ${DEFAULT_MAX_BYTES}).`),
});

/**
 * Read a UTF-8 text file. With `offset`/`limit` it returns a line range — handy
 * for jumping to a `search_code` hit in a large file without loading the whole
 * thing. `lineNumbers` adds `cat -n`-style prefixes for orientation (kept off by
 * default so the model doesn't paste them into edits).
 */
export const readFileTool = defineTool({
  name: "read_file",
  description: "Read a UTF-8 text file, optionally a line range (offset/limit) and with line numbers.",
  schema,
  async execute({ path, offset, limit, lineNumbers, maxBytes }, ctx) {
    const target = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    const contents = await readFile(target, "utf8");

    if (offset !== undefined || limit !== undefined) {
      const allLines = contents.split("\n");
      const start = (offset ?? 1) - 1;
      const end = limit !== undefined ? start + limit : allLines.length;
      const slice = allLines.slice(start, end);
      const rendered = lineNumbers ? withLineNumbers(slice, start + 1) : slice.join("\n");
      const shownEnd = Math.min(end, allLines.length);
      const note =
        shownEnd < allLines.length || start > 0
          ? `\n\n[lines ${start + 1}-${shownEnd} of ${allLines.length}]`
          : "";
      return rendered + note;
    }

    if (lineNumbers) {
      return withLineNumbers(contents.split("\n"), 1);
    }

    const limitBytes = maxBytes ?? DEFAULT_MAX_BYTES;
    if (contents.length <= limitBytes) {
      return contents;
    }
    return `${contents.slice(0, limitBytes)}\n\n[truncated at ${limitBytes} bytes — read a line range with offset/limit]`;
  },
});

function withLineNumbers(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines.map((line, i) => `${String(startLine + i).padStart(width)}\t${line}`).join("\n");
}
