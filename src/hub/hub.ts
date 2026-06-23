import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  installFromQuarantine,
  quarantineBundle,
  uninstallSkill,
  type InstallOutcome,
} from "./bundle";
import { decideInstall, formatScanReport, scanBundle, type ScanResult } from "./scanner";
import { CatalogSource } from "./sources/catalog";
import { GitHubSource } from "./sources/github";
import type { FetchFn, SkillSource } from "./sources/types";
import { UrlSource } from "./sources/url";
import {
  appendAudit,
  HubLock,
  hubPaths,
  readAudit,
  TapsManager,
  type AuditEntry,
  type HubPaths,
  type LockEntry,
  type Tap,
} from "./state";
import type { SkillBundle, SkillMeta } from "./types";

export interface HubOptions {
  skillsDir: string;
  fetchFn?: FetchFn;
  taps?: Tap[];
  token?: string;
}

export type InstallStatus = "installed" | "declined";

export interface InstallResult {
  status: InstallStatus;
  scan: ScanResult;
  report: string;
  outcome?: InstallOutcome;
}

/** Asked to confirm before installing a skill that needs confirmation. */
export type ConfirmFn = (scan: ScanResult, report: string) => Promise<boolean> | boolean;

const TRUST_RANK = { builtin: 3, trusted: 2, community: 1, "agent-created": 0 } as const;

/**
 * High-level skills hub: searches and previews across sources, and installs a
 * skill through the fetch → quarantine → scan → policy → install pipeline,
 * recording provenance and audit entries along the way.
 */
export class Hub {
  readonly paths: HubPaths;
  private readonly sources: SkillSource[];
  private readonly catalog: CatalogSource;

  constructor(options: HubOptions) {
    this.paths = hubPaths(options.skillsDir);
    const fetchFn = options.fetchFn ?? fetch;
    const github = new GitHubSource(fetchFn, {
      ...(options.taps ? { taps: options.taps } : {}),
      ...(options.token ? { token: options.token } : {}),
    });
    this.catalog = new CatalogSource();
    this.sources = [github, new UrlSource(fetchFn), this.catalog];
  }

  /** Search every source and merge by name, preferring higher-trust results. */
  async search(query: string, limit = 10): Promise<SkillMeta[]> {
    const byName = new Map<string, SkillMeta>();
    for (const source of this.sources) {
      let results: SkillMeta[] = [];
      try {
        results = await source.search(query, limit);
      } catch {
        results = [];
      }
      for (const meta of results) {
        const existing = byName.get(meta.name);
        if (!existing || TRUST_RANK[meta.trustLevel] > TRUST_RANK[existing.trustLevel]) {
          byName.set(meta.name, meta);
        }
      }
    }
    return [...byName.values()].slice(0, limit);
  }

  /** Resolve a token (identifier, URL, or catalog name) to a concrete identifier. */
  async resolve(token: string): Promise<string | null> {
    if (this.sources.some((s) => s.matches(token))) {
      return token;
    }
    const entry = await this.catalog.inspect(token);
    return entry?.identifier ?? null;
  }

  async inspect(token: string): Promise<SkillMeta | null> {
    const identifier = (await this.resolve(token)) ?? token;
    for (const source of this.sources) {
      if (source.matches(identifier)) {
        const meta = await source.inspect(identifier);
        if (meta) {
          return meta;
        }
      }
    }
    return this.catalog.inspect(token);
  }

  /**
   * Install a skill end-to-end. Blocks dangerous community skills; for skills
   * that need confirmation, calls `confirm` (and declines if it isn't provided
   * or returns false). `force` overrides a block.
   */
  async install(
    token: string,
    options: { force?: boolean; confirm?: ConfirmFn } = {},
  ): Promise<InstallResult> {
    const identifier = await this.resolve(token);
    if (!identifier) {
      throw new Error(`Could not resolve skill '${token}'`);
    }
    const source = this.sources.find((s) => s.matches(identifier));
    if (!source) {
      throw new Error(`No source can install '${identifier}'`);
    }

    const bundle = await source.fetch(identifier);
    if (!bundle) {
      throw new Error(`Could not fetch '${identifier}' (not found, or GitHub rate-limited)`);
    }

    await quarantineBundle(this.paths, bundle);
    const scan = scanBundle({ name: bundle.name, files: bundle.files }, bundle.identifier, bundle.trustLevel);
    const report = formatScanReport(scan, options.force);
    const decision = decideInstall(scan, options.force);

    if (decision.decision === "block") {
      await this.discard(bundle);
      await appendAudit(this.paths.auditLog, "BLOCK", bundle.name, `${bundle.source}:${bundle.trustLevel}`, scan.verdict, "policy");
      throw new Error(`${decision.reason}\n\n${report}`);
    }

    if (decision.decision === "ask") {
      const ok = options.confirm ? await options.confirm(scan, report) : false;
      if (!ok) {
        await this.discard(bundle);
        await appendAudit(this.paths.auditLog, "DECLINE", bundle.name, `${bundle.source}:${bundle.trustLevel}`, scan.verdict, "user");
        return { status: "declined", scan, report };
      }
    }

    const outcome = await installFromQuarantine(this.paths, bundle, scan, options.force || decision.decision === "ask");
    return { status: "installed", scan, report, outcome };
  }

  private async discard(bundle: SkillBundle): Promise<void> {
    await rm(join(this.paths.quarantineDir, bundle.name), { recursive: true, force: true });
  }

  uninstall(name: string): Promise<string> {
    return uninstallSkill(this.paths, name);
  }

  listInstalled(): Promise<Array<LockEntry & { name: string }>> {
    return new HubLock(this.paths.lockFile).list();
  }

  audit(): Promise<AuditEntry[]> {
    return readAudit(this.paths.auditLog);
  }

  taps(): TapsManager {
    return new TapsManager(this.paths.tapsFile);
  }
}
