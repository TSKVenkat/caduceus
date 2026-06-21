import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool";

const schema = z.object({
  path: z.string().min(1).describe("File path, absolute or relative to the working directory."),
  old_string: z
    .string()
    .min(1)
    .describe("Exact text to replace. Must appear exactly once — include surrounding context to make it unique."),
  new_string: z.string().describe("Replacement text."),
});

/**
 * Surgical edit (search/replace) — the token-cheap edit format. Instead of
 * rewriting a whole file with write_file, the model emits only the snippet to
 * change. `old_string` must match exactly once so the edit is unambiguous.
 */
export const strReplaceTool = defineTool({
  name: "str_replace",
  description:
    "Edit an existing file by replacing an exact, unique snippet. Prefer this over rewriting a whole file with write_file.",
  schema,
  async execute({ path, old_string, new_string }, ctx) {
    const target = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    const contents = await readFile(target, "utf8");

    const occurrences = contents.split(old_string).length - 1;
    if (occurrences === 0) {
      throw new Error(`old_string not found in ${path}`);
    }
    if (occurrences > 1) {
      throw new Error(
        `old_string matches ${occurrences} times in ${path}; add surrounding context to make it unique`,
      );
    }

    await writeFile(target, contents.replace(old_string, new_string), "utf8");
    return `Edited ${path} (replaced 1 occurrence).`;
  },
});
