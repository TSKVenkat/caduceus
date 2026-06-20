import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool";

const schema = z.object({
  path: z.string().min(1).describe("File path, absolute or relative to the working directory."),
  content: z.string().describe("Full contents to write; overwrites any existing file."),
});

export const writeFileTool = defineTool({
  name: "write_file",
  description: "Create or overwrite a file, creating parent directories as needed.",
  schema,
  async execute({ path, content }, ctx) {
    const target = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path}`;
  },
});
