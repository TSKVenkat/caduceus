import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { defineTool, type Tool } from "../tools/tool";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FILE_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Lets the agent grow its own skill library at runtime (Voyager-style procedural
 * memory): it saves a reusable procedure as a Skill — a SKILL.md plus an optional
 * executable script — that future runs discover via the skill catalog and the
 * current run can invoke via bash.
 */
export function createCreateSkillTool(skillsDir: string): Tool {
  return defineTool({
    name: "create_skill",
    description:
      "Save a reusable skill (a SKILL.md and an optional script) so this and future runs can repeat a procedure. Create one when a multi-step procedure is worth reusing; test any script before relying on it.",
    schema: z.object({
      name: z
        .string()
        .regex(NAME_PATTERN, "lowercase letters, digits, and hyphens only")
        .describe("Skill folder name, e.g. run-migrations."),
      description: z.string().min(1).describe("One line: what it does and when to use it."),
      instructions: z.string().min(1).describe("SKILL.md body: how to perform the procedure."),
      script: z.string().optional().describe("Optional executable script contents."),
      scriptName: z.string().optional().describe("Script filename (e.g. run.sh). Required with script."),
    }),
    async execute({ name, description, instructions, script, scriptName }) {
      const dir = join(skillsDir, name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "SKILL.md"),
        `---\n${stringifyYaml({ name, description })}---\n\n${instructions.trim()}\n`,
        "utf8",
      );

      let scriptNote = "";
      if (script !== undefined) {
        const file = scriptName ?? "run.sh";
        if (!FILE_PATTERN.test(file)) {
          throw new Error(`invalid scriptName: ${file}`);
        }
        await mkdir(join(dir, "scripts"), { recursive: true });
        const scriptPath = join(dir, "scripts", file);
        await writeFile(scriptPath, script, "utf8");
        await chmod(scriptPath, 0o755);
        scriptNote = ` with scripts/${file}`;
      }

      return `Created skill '${name}'${scriptNote}. It joins the skill catalog on the next run; run its script via bash to use it now.`;
    },
  });
}
