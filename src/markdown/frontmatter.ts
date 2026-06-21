import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Split a `---`-delimited YAML frontmatter block from the Markdown body.
 * Shared by the Skills and OKF knowledge layers, which are both directories of
 * Markdown documents with YAML frontmatter.
 */
export function parseFrontmatter(content: string): Frontmatter {
  const match = FRONTMATTER.exec(content);
  if (!match) {
    return { data: {}, body: content.trim() };
  }
  const parsed: unknown = parseYaml(match[1] ?? "");
  const data =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return { data, body: (match[2] ?? "").trim() };
}
