import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSkillsCli } from "../src/cli-skills";

describe("runSkillsCli (offline commands)", () => {
  let dir: string;
  let output: string;
  const out = (t: string) => {
    output += t;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-cli-skills-"));
    output = "";
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints help with no command", async () => {
    const code = await runSkillsCli([], { skillsDir: dir, out });
    expect(code).toBe(0);
    expect(output).toContain("skills search");
  });

  it("reports no installed skills", async () => {
    expect(await runSkillsCli(["list"], { skillsDir: dir, out })).toBe(0);
    expect(output).toContain("No hub-installed skills");
  });

  it("manages taps", async () => {
    await runSkillsCli(["tap", "add", "octo/skills"], { skillsDir: dir, out });
    expect(output).toContain("Tapped octo/skills");
    output = "";
    await runSkillsCli(["tap"], { skillsDir: dir, out });
    expect(output).toContain("octo/skills");
    output = "";
    await runSkillsCli(["tap", "remove", "octo/skills"], { skillsDir: dir, out });
    expect(output).toContain("Removed tap");
  });

  it("shows an empty audit log", async () => {
    expect(await runSkillsCli(["audit"], { skillsDir: dir, out })).toBe(0);
    expect(output).toContain("empty");
  });

  it("fails to uninstall an unknown skill", async () => {
    expect(await runSkillsCli(["uninstall", "ghost"], { skillsDir: dir, out })).toBe(1);
    expect(output).toContain("not a hub-installed skill");
  });
});
