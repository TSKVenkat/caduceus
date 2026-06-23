import type { SkillBundle, SkillMeta } from "../types";

/** Minimal HTTP response shape — `globalThis.fetch`'s Response satisfies it. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<HttpResponse>;

/** A registry adapter that can search, preview, and download skills. */
export interface SkillSource {
  readonly id: string;
  /** Whether this source recognizes the given identifier (for install routing). */
  matches(identifier: string): boolean;
  search(query: string, limit: number): Promise<SkillMeta[]>;
  inspect(identifier: string): Promise<SkillMeta | null>;
  fetch(identifier: string): Promise<SkillBundle | null>;
}

/** Repos whose skills are treated as trusted (caution verdicts allowed). */
export const TRUSTED_REPOS = new Set(["anthropics/skills", "openai/skills"]);

/** GitHub repos searched by default, in addition to user taps. */
export const DEFAULT_TAPS: Array<{ repo: string; path: string }> = [
  { repo: "anthropics/skills", path: "skills/" },
  { repo: "openai/skills", path: "skills/" },
];
