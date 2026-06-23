import type { SkillMeta } from "../types";
import type { SkillSource } from "./types";

/**
 * A small curated catalog of skills hosted in trusted repos. It lets `search`
 * return useful results offline (no GitHub round-trip) and gives new users a
 * starting point; each entry's identifier resolves through the GitHub source on
 * install. Extend by adding entries or by tapping more repos.
 */
const ANTHROPIC = (name: string, description: string, tags: string[]): SkillMeta => ({
  name,
  description,
  source: "catalog",
  identifier: `anthropics/skills/skills/${name}`,
  trustLevel: "trusted",
  repo: "anthropics/skills",
  path: `skills/${name}`,
  tags,
});

export const CATALOG: SkillMeta[] = [
  ANTHROPIC("pdf", "Read, fill, and extract data from PDF documents.", ["documents", "pdf"]),
  ANTHROPIC("docx", "Create and edit Microsoft Word documents.", ["documents", "word"]),
  ANTHROPIC("xlsx", "Create and analyze Microsoft Excel spreadsheets.", ["documents", "excel", "spreadsheet"]),
  ANTHROPIC("pptx", "Create and edit PowerPoint presentations.", ["documents", "powerpoint", "slides"]),
  ANTHROPIC("skill-creator", "Scaffold a new well-structured skill.", ["authoring", "meta"]),
  ANTHROPIC("mcp-builder", "Build Model Context Protocol servers.", ["mcp", "tools"]),
];

/** A read-only source that searches and previews the bundled catalog. */
export class CatalogSource implements SkillSource {
  readonly id = "catalog";

  constructor(private readonly entries: SkillMeta[] = CATALOG) {}

  matches(): boolean {
    // Catalog identifiers resolve via GitHub; nothing installs directly from here.
    return false;
  }

  async search(query: string, limit: number): Promise<SkillMeta[]> {
    const lower = query.toLowerCase();
    const matches = this.entries.filter((e) => {
      const haystack = `${e.name} ${e.description} ${(e.tags ?? []).join(" ")}`.toLowerCase();
      return !lower || haystack.includes(lower);
    });
    return matches.slice(0, limit);
  }

  async inspect(identifier: string): Promise<SkillMeta | null> {
    return this.entries.find((e) => e.identifier === identifier || e.name === identifier) ?? null;
  }

  async fetch(): Promise<null> {
    return null;
  }
}
