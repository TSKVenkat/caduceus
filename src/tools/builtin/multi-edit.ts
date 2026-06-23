import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool";

const editSchema = z.object({
  old_string: z.string().min(1).describe("Exact text to find."),
  new_string: z.string().describe("Replacement text."),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence (default: false — the match must be unique)."),
});

const schema = z.object({
  path: z.string().min(1).describe("File path, absolute or relative to the working directory."),
  edits: z
    .array(editSchema)
    .min(1)
    .describe("Edits applied in order to the same file, as one atomic transaction."),
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Apply several find/replace edits to a single file in one atomic call. Edits
 * apply in order against the evolving content; if any one fails to match (or is
 * ambiguous without `replace_all`), nothing is written. This avoids the
 * either/or of `str_replace` (one unique edit) vs `write_file` (whole-file
 * rewrite) when changing a large file in several places.
 */
export const multiEditTool = defineTool({
  name: "multi_edit",
  description:
    "Apply multiple find/replace edits to one file atomically. Use for several changes to the same file in a single step; supports replace_all.",
  schema,
  async execute({ path, edits }, ctx) {
    const target = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    const original = await readFile(target, "utf8");

    let content = original;
    let replacements = 0;
    edits.forEach((edit, index) => {
      const label = `edit ${index + 1}`;
      if (edit.old_string === edit.new_string) {
        throw new Error(`${label}: old_string and new_string are identical`);
      }
      const occurrences = countOccurrences(content, edit.old_string);
      if (occurrences === 0) {
        throw new Error(`${label}: old_string not found (after applying earlier edits)`);
      }
      if (occurrences > 1 && !edit.replace_all) {
        throw new Error(
          `${label}: old_string matches ${occurrences} times; add surrounding context or set replace_all`,
        );
      }
      content = edit.replace_all
        ? content.split(edit.old_string).join(edit.new_string)
        : content.replace(edit.old_string, edit.new_string);
      replacements += edit.replace_all ? occurrences : 1;
    });

    if (content === original) {
      return `No changes — content was already as specified in ${path}.`;
    }
    await writeFile(target, content, "utf8");
    return `Edited ${path} (${edits.length} edit(s), ${replacements} replacement(s)).`;
  },
});
