import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { multiEditTool } from "../src/tools/builtin/multi-edit";

describe("multi_edit", () => {
  let dir: string;
  let file: string;
  const ctx = () => ({ cwd: dir });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-edit-"));
    file = join(dir, "code.ts");
    await writeFile(file, "const a = 1;\nconst b = 2;\nlet x = 0;\nlet x2 = x;\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("applies multiple edits in order, atomically", async () => {
    const out = await multiEditTool.run(
      {
        path: "code.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const a = 10;" },
          { old_string: "const b = 2;", new_string: "const b = 20;" },
        ],
      },
      ctx(),
    );
    expect(out).toMatch(/2 edit\(s\), 2 replacement\(s\)/);
    expect(await readFile(file, "utf8")).toContain("const a = 10;");
    expect(await readFile(file, "utf8")).toContain("const b = 20;");
  });

  it("supports replace_all", async () => {
    await multiEditTool.run(
      { path: "code.ts", edits: [{ old_string: "x", new_string: "y", replace_all: true }] },
      ctx(),
    );
    const text = await readFile(file, "utf8");
    expect(text).toContain("let y = 0;");
    expect(text).toContain("let y2 = y;");
    expect(text).not.toContain("x");
  });

  it("rejects an ambiguous edit without replace_all and writes nothing", async () => {
    const before = await readFile(file, "utf8");
    await expect(
      multiEditTool.run({ path: "code.ts", edits: [{ old_string: "const", new_string: "let" }] }, ctx()),
    ).rejects.toThrow(/matches 2 times/);
    expect(await readFile(file, "utf8")).toBe(before); // unchanged
  });

  it("is atomic: a later failing edit reverts the whole transaction", async () => {
    const before = await readFile(file, "utf8");
    await expect(
      multiEditTool.run(
        {
          path: "code.ts",
          edits: [
            { old_string: "const a = 1;", new_string: "const a = 99;" },
            { old_string: "does-not-exist", new_string: "nope" },
          ],
        },
        ctx(),
      ),
    ).rejects.toThrow(/edit 2: old_string not found/);
    expect(await readFile(file, "utf8")).toBe(before); // first edit not persisted
  });

  it("can match text created by an earlier edit", async () => {
    await multiEditTool.run(
      {
        path: "code.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const a = 1; // marker" },
          { old_string: "// marker", new_string: "// done" },
        ],
      },
      ctx(),
    );
    expect(await readFile(file, "utf8")).toContain("// done");
  });
});
