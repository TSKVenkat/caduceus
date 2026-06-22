import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCreateSkillTool } from "../src/skills/create-skill-tool";
import { loadSkills, readSkillBody } from "../src/skills/loader";

describe("create_skill", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-create-skill-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a loadable skill with an executable script", async () => {
    const tool = createCreateSkillTool(dir);
    await tool.run(
      {
        name: "count-lines",
        description: "Count lines in a file.",
        instructions: "Run scripts/run.sh <file> to print the line count.",
        script: "#!/usr/bin/env bash\nwc -l < \"$1\"\n",
        scriptName: "run.sh",
      },
      { cwd: dir },
    );

    const skills = await loadSkills(dir);
    expect(skills.map((s) => s.name)).toEqual(["count-lines"]);
    const [skill] = skills;
    if (!skill) {
      throw new Error("skill not loaded");
    }
    await expect(readSkillBody(skill)).resolves.toContain("scripts/run.sh");
    await expect(access(join(dir, "count-lines", "scripts", "run.sh"), constants.X_OK)).resolves.toBeUndefined();
  });

  it("rejects invalid skill names", async () => {
    const tool = createCreateSkillTool(dir);
    await expect(
      tool.run({ name: "../evil", description: "x", instructions: "y" }, { cwd: dir }),
    ).rejects.toThrow();
  });
});
