import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseFrontmatter } from "../markdown/frontmatter";

/**
 * A concept in an Open Knowledge Format (OKF) bundle. The bundle is a directory
 * of Markdown files with YAML frontmatter; each non-reserved file is a concept
 * whose id is its path minus the `.md` suffix. Only `type` is required.
 *
 * @see https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 */
export interface OkfConcept {
  /** Path relative to the bundle root, without `.md` — e.g. `tables/orders`. */
  id: string;
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  /** Absolute path to the concept file. */
  path: string;
}

export interface WriteConceptInput {
  id: string;
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  body: string;
}

/** Reserved filenames that are not concepts (OKF v0.1). */
const RESERVED_FILES = new Set(["index.md", "log.md"]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Validate a concept id: relative, no traversal, safe path segments. */
export function isValidConceptId(id: string): boolean {
  if (!ID_PATTERN.test(id)) {
    return false;
  }
  return id.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Discover all concepts in a bundle. Malformed or untyped files are skipped (spec: tolerate). */
export async function loadBundle(bundleDir: string): Promise<OkfConcept[]> {
  if (!existsSync(bundleDir)) {
    return [];
  }

  const entries = await readdir(bundleDir, { recursive: true, withFileTypes: true });
  const concepts: OkfConcept[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || RESERVED_FILES.has(entry.name)) {
      continue;
    }
    const path = join(entry.parentPath, entry.name);
    const { data } = parseFrontmatter(await readFile(path, "utf8"));
    const type = asString(data.type);
    if (!type) {
      continue;
    }
    concepts.push({
      id: toConceptId(bundleDir, path),
      type,
      ...optional("title", asString(data.title)),
      ...optional("description", asString(data.description)),
      ...optional("resource", asString(data.resource)),
      ...optional("tags", asStringArray(data.tags)),
      ...optional("timestamp", asString(data.timestamp)),
      path,
    });
  }

  concepts.sort((a, b) => a.id.localeCompare(b.id));
  return concepts;
}

/** Read a concept's Markdown body (without frontmatter) by id. */
export async function readConcept(bundleDir: string, id: string): Promise<string> {
  const path = conceptPath(bundleDir, id);
  return parseFrontmatter(await readFile(path, "utf8")).body;
}

/** Create or overwrite a concept document, writing valid OKF frontmatter. */
export async function writeConcept(
  bundleDir: string,
  input: WriteConceptInput,
  now: Date,
): Promise<string> {
  const path = conceptPath(bundleDir, input.id);
  const frontmatter: Record<string, unknown> = { type: input.type };
  if (input.title) frontmatter.title = input.title;
  if (input.description) frontmatter.description = input.description;
  if (input.resource) frontmatter.resource = input.resource;
  if (input.tags && input.tags.length > 0) frontmatter.tags = input.tags;
  frontmatter.timestamp = now.toISOString();

  const document = `---\n${stringifyYaml(frontmatter)}---\n\n${input.body.trim()}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, document, "utf8");
  return input.id;
}

/** Append a dated entry to the bundle's log.md, newest first (OKF v0.1). */
export async function appendLog(bundleDir: string, entry: string, now: Date): Promise<void> {
  const header = "# Log\n\n";
  const block = `## ${now.toISOString().slice(0, 10)}\n\n- ${entry.trim()}\n\n`;
  const logPath = join(bundleDir, "log.md");

  let rest = "";
  if (existsSync(logPath)) {
    const current = await readFile(logPath, "utf8");
    rest = current.startsWith(header) ? current.slice(header.length) : current;
  }
  await mkdir(bundleDir, { recursive: true });
  await writeFile(logPath, header + block + rest, "utf8");
}

function conceptPath(bundleDir: string, id: string): string {
  if (!isValidConceptId(id)) {
    throw new Error(`Invalid concept id: ${id}`);
  }
  const path = resolve(bundleDir, `${id}.md`);
  const root = resolve(bundleDir);
  if (path !== root && !path.startsWith(root + sep)) {
    throw new Error(`Concept id escapes the bundle: ${id}`);
  }
  return path;
}

function toConceptId(bundleDir: string, path: string): string {
  const rel = relative(bundleDir, path).split(sep).join("/");
  return rel.slice(0, -".md".length);
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : { [key]: value };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}
