import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLog, isValidConceptId, loadBundle, readConcept, writeConcept } from "../src/knowledge/okf";
import { createKnowledgeTools } from "../src/knowledge/tools";

const NOW = new Date("2026-06-21T12:00:00.000Z");

describe("isValidConceptId", () => {
  it("accepts nested ids and rejects traversal", () => {
    expect(isValidConceptId("architecture/agent-loop")).toBe(true);
    expect(isValidConceptId("../escape")).toBe(false);
    expect(isValidConceptId("/abs")).toBe(false);
    expect(isValidConceptId("a/../b")).toBe(false);
  });
});

describe("loadBundle", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-okf-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(rel: string, contents: string): Promise<void> {
    const path = join(dir, rel);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }

  it("returns an empty list for a missing directory", async () => {
    await expect(loadBundle(join(dir, "missing"))).resolves.toEqual([]);
  });

  it("loads typed concepts, derives ids, and skips reserved/untyped files", async () => {
    await write("tables/orders.md", "---\ntype: Table\ndescription: Orders.\n---\nbody");
    await write("metrics/wau.md", "---\ntype: Metric\n---\nbody");
    await write("index.md", "---\ntype: Index\n---\nlisting"); // reserved
    await write("notes/draft.md", "---\ntitle: no type here\n---\nbody"); // untyped -> skipped

    const concepts = await loadBundle(dir);
    expect(concepts.map((c) => c.id)).toEqual(["metrics/wau", "tables/orders"]);
    expect(concepts.find((c) => c.id === "tables/orders")?.type).toBe("Table");
  });
});

describe("authoring", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-okf-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writeConcept produces a loadable, readable concept", async () => {
    await writeConcept(
      dir,
      { id: "architecture/loop", type: "Architecture", description: "The loop.", body: "# Loop\ndetails" },
      NOW,
    );

    const concepts = await loadBundle(dir);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]).toMatchObject({ id: "architecture/loop", type: "Architecture", timestamp: NOW.toISOString() });
    await expect(readConcept(dir, "architecture/loop")).resolves.toContain("# Loop");
  });

  it("appendLog writes newest entries first", async () => {
    await appendLog(dir, "first", new Date("2026-06-20T00:00:00Z"));
    await appendLog(dir, "second", new Date("2026-06-21T00:00:00Z"));
    const log = await readFile(join(dir, "log.md"), "utf8");
    expect(log.indexOf("second")).toBeLessThan(log.indexOf("first"));
    expect(log).toContain("## 2026-06-21");
  });

  it("write_concept tool rejects ids that escape the bundle", async () => {
    const [, writeTool] = createKnowledgeTools(dir);
    await expect(writeTool?.run({ id: "../evil", type: "X", body: "y" }, { cwd: dir })).rejects.toThrow();
  });
});
