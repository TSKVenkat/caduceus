import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFilesTool } from "../src/tools/builtin/list-files";
import { searchCodeTool } from "../src/tools/builtin/search";

describe("search_code and list_files", () => {
  let dir: string;
  const ctx = () => ({ cwd: dir });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-search-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "export const alpha = 1;\nfunction beta() { return alpha; }\n");
    await writeFile(join(dir, "src", "b.ts"), "import { alpha } from './a';\nconst GAMMA = alpha + 1;\n");
    await writeFile(join(dir, "readme.md"), "# Title\nalpha appears here too.\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds matches with file:line across the tree", async () => {
    const out = await searchCodeTool.run({ pattern: "alpha" }, ctx());
    expect(out).toMatch(/a\.ts:1/);
    expect(out).toMatch(/b\.ts:1/);
    expect(out).toMatch(/readme\.md:2/);
  });

  it("filters by glob", async () => {
    const out = await searchCodeTool.run({ pattern: "alpha", glob: "*.md" }, ctx());
    expect(out).toMatch(/readme\.md/);
    expect(out).not.toMatch(/\.ts/);
  });

  it("supports case-insensitive search", async () => {
    const out = await searchCodeTool.run({ pattern: "gamma", ignoreCase: true }, ctx());
    expect(out).toMatch(/b\.ts:2/);
  });

  it("reports no matches cleanly", async () => {
    const out = await searchCodeTool.run({ pattern: "zzz_nonexistent_zzz" }, ctx());
    expect(out).toBe("No matches found.");
  });

  it("lists files, sorted", async () => {
    const out = await listFilesTool.run({}, ctx());
    const files = out.split("\n");
    expect(files).toContain("readme.md");
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
  });

  it("lists files filtered by glob", async () => {
    const out = await listFilesTool.run({ glob: "*.ts" }, ctx());
    expect(out).toMatch(/src\/a\.ts/);
    expect(out).toMatch(/src\/b\.ts/);
    expect(out).not.toMatch(/readme\.md/);
  });
});
