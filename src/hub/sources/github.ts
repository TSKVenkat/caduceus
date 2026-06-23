import { parseFrontmatter } from "../../markdown/frontmatter";
import { resolveTrustLevel } from "../scanner";
import type { SkillBundle, SkillMeta } from "../types";
import { DEFAULT_TAPS, type FetchFn, type HttpResponse, type SkillSource } from "./types";

interface ContentsEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

const MAX_DEPTH = 3;

/**
 * Fetch skills from GitHub repositories via the Contents API.
 *
 * Identifiers are `owner/repo/path/to/skill-dir`. Public access is unauthenticated
 * (subject to GitHub's 60 req/hr limit); a token may be supplied to raise it. The
 * `fetchFn` is injectable so the adapter is testable without the network.
 */
export class GitHubSource implements SkillSource {
  readonly id = "github";
  private readonly taps: Array<{ repo: string; path: string }>;

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    options: { taps?: Array<{ repo: string; path: string }>; token?: string } = {},
  ) {
    this.taps = [...DEFAULT_TAPS, ...(options.taps ?? [])];
    this.token = options.token;
  }

  private readonly token: string | undefined;

  matches(identifier: string): boolean {
    return !/^https?:\/\//i.test(identifier) && identifier.split("/").length >= 3;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "caduceus-skills-hub",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async getJson(url: string): Promise<unknown> {
    let resp: HttpResponse;
    try {
      resp = await this.fetchFn(url, { headers: this.headers() });
    } catch {
      return null;
    }
    if (!resp.ok) {
      return null;
    }
    try {
      return await resp.json();
    } catch {
      return null;
    }
  }

  private trustFor(identifier: string): SkillMeta["trustLevel"] {
    return resolveTrustLevel(identifier);
  }

  async search(query: string, limit: number): Promise<SkillMeta[]> {
    const lower = query.toLowerCase();
    const byName = new Map<string, SkillMeta>();
    const rank = { builtin: 3, trusted: 2, community: 1, "agent-created": 0 } as const;

    for (const tap of this.taps) {
      const url = `https://api.github.com/repos/${tap.repo}/contents/${tap.path.replace(/\/$/, "")}`;
      const entries = await this.getJson(url);
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries as ContentsEntry[]) {
        if (entry.type !== "dir" || entry.name.startsWith(".") || entry.name.startsWith("_")) {
          continue;
        }
        const identifier = `${tap.repo}/${entry.path}`;
        const meta = await this.inspect(identifier);
        if (!meta) {
          continue;
        }
        const haystack = `${meta.name} ${meta.description} ${(meta.tags ?? []).join(" ")}`.toLowerCase();
        if (lower && !haystack.includes(lower)) {
          continue;
        }
        const existing = byName.get(meta.name);
        if (!existing || rank[meta.trustLevel] > rank[existing.trustLevel]) {
          byName.set(meta.name, meta);
        }
      }
    }
    return [...byName.values()].slice(0, limit);
  }

  async inspect(identifier: string): Promise<SkillMeta | null> {
    const [owner, repo, ...rest] = identifier.split("/");
    if (!owner || !repo || rest.length === 0) {
      return null;
    }
    const skillPath = rest.join("/").replace(/\/$/, "");
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}/SKILL.md`;
    const json = await this.getJson(url);
    const content = decodeContent(json);
    if (content === null) {
      return null;
    }
    const { data } = parseFrontmatter(content);
    const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
    return {
      name: typeof data.name === "string" ? data.name : (skillPath.split("/").pop() ?? skillPath),
      description: typeof data.description === "string" ? data.description : "",
      source: this.id,
      identifier,
      trustLevel: this.trustFor(identifier),
      repo: `${owner}/${repo}`,
      path: skillPath,
      tags,
    };
  }

  async fetch(identifier: string): Promise<SkillBundle | null> {
    const [owner, repo, ...rest] = identifier.split("/");
    if (!owner || !repo || rest.length === 0) {
      return null;
    }
    const skillPath = rest.join("/").replace(/\/$/, "");
    const files = await this.downloadDir(`${owner}/${repo}`, skillPath, "", 0);
    if (!files || !files["SKILL.md"]) {
      return null;
    }
    const meta = await this.inspect(identifier);
    return {
      name: skillPath.split("/").pop() ?? skillPath,
      description: meta?.description ?? "",
      source: this.id,
      identifier,
      trustLevel: this.trustFor(identifier),
      ...(meta?.category ? { category: meta.category } : {}),
      files,
    };
  }

  /** Recursively download a directory's files, keyed by path relative to the skill root. */
  private async downloadDir(
    repo: string,
    dirPath: string,
    relPrefix: string,
    depth: number,
  ): Promise<Record<string, string> | null> {
    if (depth > MAX_DEPTH) {
      return {};
    }
    const entries = await this.getJson(`https://api.github.com/repos/${repo}/contents/${dirPath}`);
    if (!Array.isArray(entries)) {
      return null;
    }
    const files: Record<string, string> = {};
    for (const entry of entries as ContentsEntry[]) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.type === "dir") {
        const nested = await this.downloadDir(repo, entry.path, rel, depth + 1);
        Object.assign(files, nested ?? {});
      } else if (entry.type === "file" && entry.download_url) {
        const text = await this.getRaw(entry.download_url);
        if (text !== null) {
          files[rel] = text;
        }
      }
    }
    return files;
  }

  private async getRaw(url: string): Promise<string | null> {
    try {
      const resp = await this.fetchFn(url, { headers: { "User-Agent": "caduceus-skills-hub" } });
      return resp.ok ? await resp.text() : null;
    } catch {
      return null;
    }
  }
}

/** Decode a GitHub Contents API file response (base64) into text. */
function decodeContent(json: unknown): string | null {
  if (!json || typeof json !== "object") {
    return null;
  }
  const obj = json as { content?: unknown; encoding?: unknown };
  if (typeof obj.content !== "string") {
    return null;
  }
  if (obj.encoding === "base64") {
    return Buffer.from(obj.content, "base64").toString("utf8");
  }
  return obj.content;
}
