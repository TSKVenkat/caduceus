import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strReplaceTool } from "../src/tools/builtin/str-replace";

describe("str_replace", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-edit-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("replaces a unique snippet", async () => {
    await writeFile(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n", "utf8");
    const out = await strReplaceTool.run(
      { path: "a.ts", old_string: "const x = 1;", new_string: "const x = 42;" },
      { cwd: dir },
    );
    expect(out).toContain("replaced 1 occurrence");
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("const x = 42;\nconst y = 2;\n");
  });

  it("errors when the snippet is absent", async () => {
    await writeFile(join(dir, "a.ts"), "hello\n", "utf8");
    await expect(
      strReplaceTool.run({ path: "a.ts", old_string: "missing", new_string: "x" }, { cwd: dir }),
    ).rejects.toThrow(/not found/);
  });

  it("errors when the snippet is not unique", async () => {
    await writeFile(join(dir, "a.ts"), "dup\ndup\n", "utf8");
    await expect(
      strReplaceTool.run({ path: "a.ts", old_string: "dup", new_string: "x" }, { cwd: dir }),
    ).rejects.toThrow(/matches 2 times/);
  });
});
