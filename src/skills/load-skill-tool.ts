import { z } from "zod";
import { defineTool, type Tool } from "../tools/tool";
import { readSkillBody, type Skill } from "./loader";

/**
 * Build the `load_skill` tool over a set of discovered skills. This is the
 * Level-2 step of progressive disclosure: the model pulls a skill's full
 * instructions only when a task matches the catalog advertised in the prompt.
 */
export function createLoadSkillTool(skills: Skill[]): Tool {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const available = [...byName.keys()];

  return defineTool({
    name: "load_skill",
    description:
      available.length > 0
        ? `Load a skill's full instructions. Available skills: ${available.join(", ")}.`
        : "Load a skill's full instructions (none are currently available).",
    schema: z.object({ name: z.string().min(1).describe("Name of the skill to load.") }),
    async execute({ name }) {
      const skill = byName.get(name);
      if (!skill) {
        throw new Error(`Unknown skill: ${name}. Available: ${available.join(", ") || "none"}`);
      }
      return readSkillBody(skill);
    },
  });
}
