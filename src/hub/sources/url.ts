import { parseFrontmatter } from "../../markdown/frontmatter";
import type { SkillBundle, SkillMeta } from "../types";
import type { FetchFn, SkillSource } from "./types";

/**
 * Install a single-file skill straight from a URL pointing at a raw SKILL.md.
 * Always community-trust (an arbitrary URL is never implicitly trusted), so the
 * scanner gates it strictly. Not searchable.
 */
export class UrlSource implements SkillSource {
  readonly id = "url";

  constructor(private readonly fetchFn: FetchFn = fetch) {}

  matches(identifier: string): boolean {
    return /^https?:\/\//i.test(identifier);
  }

  async search(): Promise<SkillMeta[]> {
    return [];
  }

  private async getText(url: string): Promise<string | null> {
    try {
      const resp = await this.fetchFn(url, { headers: { "User-Agent": "caduceus-skills-hub" } });
      return resp.ok ? await resp.text() : null;
    } catch {
      return null;
    }
  }

  private nameFor(url: string, data: Record<string, unknown>): string {
    if (typeof data.name === "string" && data.name) {
      return data.name;
    }
    const last = url.split("/").filter(Boolean).pop() ?? "skill";
    return last.replace(/\.md$/i, "") || "skill";
  }

  async inspect(identifier: string): Promise<SkillMeta | null> {
    const content = await this.getText(identifier);
    if (content === null) {
      return null;
    }
    const { data } = parseFrontmatter(content);
    return {
      name: this.nameFor(identifier, data),
      description: typeof data.description === "string" ? data.description : "",
      source: this.id,
      identifier,
      trustLevel: "community",
    };
  }

  async fetch(identifier: string): Promise<SkillBundle | null> {
    const content = await this.getText(identifier);
    if (content === null) {
      return null;
    }
    const { data } = parseFrontmatter(content);
    return {
      name: this.nameFor(identifier, data),
      description: typeof data.description === "string" ? data.description : "",
      source: this.id,
      identifier,
      trustLevel: "community",
      files: { "SKILL.md": content },
    };
  }
}
