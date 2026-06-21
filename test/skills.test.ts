import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLoadSkillTool } from "../src/skills/load-skill-tool";
import { loadSkills, parseFrontmatter } from "../src/skills/loader";

describe("parseFrontmatter", () => {
  it("splits frontmatter from the body", () => {
    const { data, body } = parseFrontmatter("---\nname: demo\ndescription: A demo.\n---\n# Title\nbody");
    expect(data).toEqual({ name: "demo", description: "A demo." });
    expect(body).toBe("# Title\nbody");
  });

  it("returns empty data when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("just text");
    expect(data).toEqual({});
    expect(body).toBe("just text");
  });
});

describe("loadSkills", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "caduceus-skills-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSkill(dirName: string, contents: string): Promise<void> {
    const dir = join(root, dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), contents, "utf8");
  }

  it("returns an empty list for a missing directory", async () => {
    await expect(loadSkills(join(root, "nope"))).resolves.toEqual([]);
  });

  it("loads valid skills sorted by name and skips malformed ones", async () => {
    await writeSkill("b", "---\nname: beta\ndescription: Second.\n---\nbody b");
    await writeSkill("a", "---\nname: alpha\ndescription: First.\n---\nbody a");
    await writeSkill("c", "---\ndescription: missing name\n---\nbody c");

    const skills = await loadSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(skills[0]?.description).toBe("First.");
  });

  it("load_skill tool returns the body and errors on unknown names", async () => {
    await writeSkill("a", "---\nname: alpha\ndescription: First.\n---\nthe instructions");
    const skills = await loadSkills(root);
    const tool = createLoadSkillTool(skills);

    await expect(tool.run({ name: "alpha" }, { cwd: root })).resolves.toBe("the instructions");
    await expect(tool.run({ name: "ghost" }, { cwd: root })).rejects.toThrow(/Unknown skill/);
  });
});
