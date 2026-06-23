import type { TrustLevel } from "./scanner";

/** Lightweight skill metadata returned by source adapters (search/inspect). */
export interface SkillMeta {
  name: string;
  description: string;
  /** Source id, e.g. "github", "url", "catalog". */
  source: string;
  /** Source-specific locator used by fetch(), e.g. "owner/repo/path" or a URL. */
  identifier: string;
  trustLevel: TrustLevel;
  repo?: string;
  path?: string;
  category?: string;
  tags?: string[];
}

/** A downloaded skill ready to quarantine, scan, and install. */
export interface SkillBundle {
  name: string;
  description: string;
  source: string;
  identifier: string;
  trustLevel: TrustLevel;
  category?: string;
  /** Files keyed by POSIX-relative path; must contain SKILL.md. */
  files: Record<string, string>;
  metadata?: Record<string, unknown>;
}
