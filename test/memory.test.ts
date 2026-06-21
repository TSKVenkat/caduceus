import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEpisodic, searchEpisodic, writeEntry } from "../src/memory/episodic";
import { createMemoryTools } from "../src/memory/tools";

const NOW = new Date("2026-06-22T00:00:00.000Z");

describe("episodic memory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-mem-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty for a missing directory", async () => {
    await expect(loadEpisodic(join(dir, "nope"))).resolves.toEqual([]);
  });

  it("writes a loadable entry and dedupes by title", async () => {
    await writeEntry(dir, { title: "Run tests with pnpm", lesson: "Use `pnpm test`.", outcome: "success", tags: ["build"] }, NOW);
    await writeEntry(dir, { title: "Run tests with pnpm", lesson: "Use `pnpm test` from the repo root.", outcome: "success" }, NOW);

    const entries = await loadEpisodic(dir);
    expect(entries).toHaveLength(1); // same title -> overwritten, not duplicated
    expect(entries[0]).toMatchObject({ slug: "run-tests-with-pnpm", title: "Run tests with pnpm", outcome: "success" });
  });

  it("ranks recall by query-term overlap", async () => {
    await writeEntry(dir, { title: "Vitest config", lesson: "Tests live in test/ and run with vitest.", tags: ["testing"] }, NOW);
    await writeEntry(dir, { title: "Esbuild note", lesson: "tsup bundles to dist via esbuild.", tags: ["build"] }, NOW);

    const hits = await searchEpisodic(dir, "how do I run the vitest tests", 3);
    expect(hits[0]?.entry.slug).toBe("vitest-config");
  });

  it("remember/recall tools round-trip; recall reports nothing when irrelevant", async () => {
    const [remember, recall] = createMemoryTools(dir);
    await remember?.run(
      { title: "Postgres dsn", lesson: "The local DB DSN is in .env as DATABASE_URL." },
      { cwd: dir },
    );
    await expect(recall?.run({ query: "database dsn connection" }, { cwd: dir })).resolves.toContain(
      "DATABASE_URL",
    );
    await expect(recall?.run({ query: "kubernetes networking" }, { cwd: dir })).resolves.toBe(
      "No relevant memories.",
    );
  });
});
