import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** A skill discovered on disk. Only metadata is held; the body is read on demand. */
export interface Skill {
  name: string;
  description: string;
  /** Absolute path to the skill directory. */
  dir: string;
  /** Absolute path to the skill's SKILL.md. */
  path: string;
}

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const metadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

/** Split a `---`-delimited YAML frontmatter block from the Markdown body. */
export function parseFrontmatter(content: string): Frontmatter {
  const match = FRONTMATTER.exec(content);
  if (!match) {
    return { data: {}, body: content.trim() };
  }
  const parsed: unknown = parseYaml(match[1] ?? "");
  const data =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return { data, body: (match[2] ?? "").trim() };
}

/**
 * Discover skills under a directory. Each skill is a subdirectory containing a
 * SKILL.md with `name` and `description` frontmatter. Malformed skills are skipped.
 */
export async function loadSkills(skillsDir: string): Promise<Skill[]> {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = join(skillsDir, entry.name);
    const path = join(dir, "SKILL.md");
    if (!existsSync(path)) {
      continue;
    }
    const { data } = parseFrontmatter(await readFile(path, "utf8"));
    const metadata = metadataSchema.safeParse(data);
    if (!metadata.success) {
      continue;
    }
    skills.push({ name: metadata.data.name, description: metadata.data.description, dir, path });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/** Read a skill's instructions (Level 2): the Markdown body without frontmatter. */
export async function readSkillBody(skill: Skill): Promise<string> {
  return parseFrontmatter(await readFile(skill.path, "utf8")).body;
}
