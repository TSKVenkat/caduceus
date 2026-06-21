import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseFrontmatter } from "../markdown/frontmatter";

export type Outcome = "success" | "failure" | "note";

/** A single episodic memory: a durable, reusable lesson from a past task. */
export interface EpisodicEntry {
  slug: string;
  title: string;
  outcome: Outcome;
  tags: string[];
  timestamp?: string;
  /** Absolute path to the entry file. */
  path: string;
}

export interface WriteEntryInput {
  title: string;
  lesson: string;
  outcome?: Outcome;
  tags?: string[];
}

/** Discover episodic memories in a directory (flat markdown files). */
export async function loadEpisodic(dir: string): Promise<EpisodicEntry[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const files = (await readdir(dir, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".md"),
  );

  const entries: EpisodicEntry[] = [];
  for (const file of files) {
    const path = join(dir, file.name);
    const { data } = parseFrontmatter(await readFile(path, "utf8"));
    entries.push({
      slug: file.name.slice(0, -".md".length),
      title: asString(data.title) ?? file.name.slice(0, -".md".length),
      outcome: asOutcome(data.outcome),
      tags: asStringArray(data.tags),
      ...optional("timestamp", asString(data.timestamp)),
      path,
    });
  }
  entries.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  return entries;
}

export async function readEntryBody(entry: EpisodicEntry): Promise<string> {
  return parseFrontmatter(await readFile(entry.path, "utf8")).body;
}

/**
 * Write (or overwrite) an episodic memory. Dedupes by slug so re-recording the
 * same lesson canonicalizes rather than duplicating — part of the strict-write
 * policy that keeps memory high-signal.
 */
export async function writeEntry(dir: string, input: WriteEntryInput, now: Date): Promise<string> {
  const slug = slugify(input.title);
  if (!slug) {
    throw new Error("memory title must contain alphanumeric characters");
  }
  const frontmatter: Record<string, unknown> = {
    title: input.title.trim(),
    outcome: input.outcome ?? "note",
  };
  if (input.tags && input.tags.length > 0) {
    frontmatter.tags = input.tags;
  }
  frontmatter.timestamp = now.toISOString();

  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${slug}.md`),
    `---\n${stringifyYaml(frontmatter)}---\n\n${input.lesson.trim()}\n`,
    "utf8",
  );
  return slug;
}

export interface RecallHit {
  entry: EpisodicEntry;
  body: string;
  score: number;
}

/**
 * Keyword recall: rank entries by how many query terms appear in their title,
 * tags, and body. Flat-file + term overlap (no vector store), token-budgeted by
 * the caller. Ties break toward more recent entries (load order).
 */
export async function searchEpisodic(
  dir: string,
  query: string,
  limit = 3,
): Promise<RecallHit[]> {
  const entries = await loadEpisodic(dir);
  const terms = tokenize(query);
  if (terms.length === 0) {
    return [];
  }

  const hits: RecallHit[] = [];
  for (const entry of entries) {
    const body = await readEntryBody(entry);
    const haystack = `${entry.title} ${entry.tags.join(" ")} ${body}`.toLowerCase();
    const score = terms.reduce((sum, term) => (haystack.includes(term) ? sum + 1 : sum), 0);
    if (score > 0) {
      hits.push({ entry, body, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asOutcome(value: unknown): Outcome {
  return value === "success" || value === "failure" ? value : "note";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : { [key]: value };
}
