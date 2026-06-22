import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createArtifactTool, loadArtifacts } from "../src/artifacts/artifacts";

describe("artifacts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-artifacts-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty for a missing directory", async () => {
    await expect(loadArtifacts(join(dir, "nope"))).resolves.toEqual([]);
  });

  it("catalogs files (with nested ids and sizes)", async () => {
    await writeFile(join(dir, "a.txt"), "hello", "utf8");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "b.txt"), "world!", "utf8");

    const artifacts = await loadArtifacts(dir);
    expect(artifacts.map((a) => a.id)).toEqual(["a.txt", "sub/b.txt"]);
    expect(artifacts.find((a) => a.id === "a.txt")?.bytes).toBe(5);
  });

  it("load_artifact reads by id and blocks traversal", async () => {
    await writeFile(join(dir, "doc.txt"), "content here", "utf8");
    const tool = createArtifactTool(dir);
    await expect(tool.run({ id: "doc.txt" }, { cwd: dir })).resolves.toBe("content here");
    await expect(tool.run({ id: "../escape" }, { cwd: dir })).rejects.toThrow(/escapes/);
  });
});
