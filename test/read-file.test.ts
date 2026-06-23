import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileTool } from "../src/tools/builtin/read-file";

describe("read_file", () => {
  let dir: string;
  const ctx = () => ({ cwd: dir });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-read-"));
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(join(dir, "f.txt"), `${lines}\n`);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the whole file by default", async () => {
    const out = await readFileTool.run({ path: "f.txt" }, ctx());
    expect(out).toContain("line 1");
    expect(out).toContain("line 10");
  });

  it("reads a line range with offset and limit", async () => {
    const out = await readFileTool.run({ path: "f.txt", offset: 3, limit: 2 }, ctx());
    expect(out).toContain("line 3");
    expect(out).toContain("line 4");
    expect(out).not.toContain("line 2");
    expect(out).not.toContain("line 5");
    expect(out).toMatch(/\[lines 3-4 of 11\]/); // 10 lines + trailing empty
  });

  it("adds line numbers when requested", async () => {
    const out = await readFileTool.run({ path: "f.txt", offset: 1, limit: 2, lineNumbers: true }, ctx());
    expect(out).toMatch(/^1\tline 1/m);
    expect(out).toMatch(/^2\tline 2/m);
  });
});
