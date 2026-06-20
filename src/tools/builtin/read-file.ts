import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool";

const DEFAULT_MAX_BYTES = 64 * 1024;

const schema = z.object({
  path: z.string().min(1).describe("File path, absolute or relative to the working directory."),
  maxBytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Maximum bytes to read (default ${DEFAULT_MAX_BYTES}).`),
});

export const readFileTool = defineTool({
  name: "read_file",
  description: "Read a UTF-8 text file from the workspace.",
  schema,
  async execute({ path, maxBytes }, ctx) {
    const target = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    const limit = maxBytes ?? DEFAULT_MAX_BYTES;
    const contents = await readFile(target, "utf8");
    if (contents.length <= limit) {
      return contents;
    }
    return `${contents.slice(0, limit)}\n\n[truncated at ${limit} bytes]`;
  },
});
