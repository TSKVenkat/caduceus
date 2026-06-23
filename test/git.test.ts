import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitTools } from "../src/tools/builtin/git";

const run = promisify(execFile);
const [statusTool, diffTool] = gitTools;

async function git(dir: string, ...args: string[]): Promise<void> {
  await run("git", args, { cwd: dir });
}

describe("git tools", () => {
  let dir: string;
  const ctx = () => ({ cwd: dir });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-git-"));
    await git(dir, "init", "-q");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "Test");
    await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\n");
    await git(dir, "add", "a.txt");
    await git(dir, "commit", "-q", "-m", "init");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("git_status shows clean and dirty trees", async () => {
    expect(await statusTool!.run({}, ctx())).toContain("working tree clean");
    await writeFile(join(dir, "b.txt"), "new\n");
    const dirty = await statusTool!.run({}, ctx());
    expect(dirty).toMatch(/\?\? b\.txt/);
  });

  it("git_diff shows unstaged changes and reports none when clean", async () => {
    expect(await diffTool!.run({}, ctx())).toBe("No unstaged changes.");
    await writeFile(join(dir, "a.txt"), "one\nTWO\nthree\n");
    const diff = await diffTool!.run({}, ctx());
    expect(diff).toContain("-two");
    expect(diff).toContain("+TWO");
  });

  it("git_diff staged shows staged changes", async () => {
    await writeFile(join(dir, "a.txt"), "one\ntwo\nfour\n");
    await git(dir, "add", "a.txt");
    expect(await diffTool!.run({}, ctx())).toBe("No unstaged changes.");
    const staged = await diffTool!.run({ staged: true }, ctx());
    expect(staged).toContain("+four");
  });

  it("git_diff stat shows a summary", async () => {
    await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\nfour\n");
    const stat = await diffTool!.run({ stat: true }, ctx());
    expect(stat).toMatch(/a\.txt\s+\|/);
  });

  it("reports a non-git directory cleanly", async () => {
    const plain = await mkdtemp(join(tmpdir(), "caduceus-nogit-"));
    try {
      expect(await statusTool!.run({}, { cwd: plain })).toBe("Not a git repository.");
      expect(await diffTool!.run({}, { cwd: plain })).toBe("Not a git repository.");
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
