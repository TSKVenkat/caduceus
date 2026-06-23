import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Resolved locations of the hub's on-disk state, rooted at `<skillsDir>/.hub`. */
export interface HubPaths {
  skillsDir: string;
  hubDir: string;
  lockFile: string;
  auditLog: string;
  tapsFile: string;
  quarantineDir: string;
  cacheDir: string;
}

export function hubPaths(skillsDir: string): HubPaths {
  const hubDir = join(skillsDir, ".hub");
  return {
    skillsDir,
    hubDir,
    lockFile: join(hubDir, "lock.json"),
    auditLog: join(hubDir, "audit.log"),
    tapsFile: join(hubDir, "taps.json"),
    quarantineDir: join(hubDir, "quarantine"),
    cacheDir: join(hubDir, "cache"),
  };
}

export async function ensureHubDirs(paths: HubPaths): Promise<void> {
  await mkdir(paths.quarantineDir, { recursive: true });
  await mkdir(paths.cacheDir, { recursive: true });
  // Keep hub internals out of ripgrep/search and the skill loader.
  const ignore = join(paths.hubDir, ".ignore");
  if (!existsSync(ignore)) {
    await writeFile(ignore, "# Hub internals — excluded from search tools\n*\n");
  }
}

// ── Lock file (provenance of installed hub skills) ──────────────────────────

export interface LockEntry {
  source: string;
  identifier: string;
  trustLevel: string;
  scanVerdict: string;
  contentHash: string;
  installPath: string;
  category: string;
  files: string[];
  installedAt: string;
}

interface LockData {
  version: number;
  installed: Record<string, LockEntry>;
}

export class HubLock {
  constructor(private readonly path: string) {}

  async load(): Promise<LockData> {
    if (!existsSync(this.path)) {
      return { version: 1, installed: {} };
    }
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as LockData;
    } catch {
      return { version: 1, installed: {} };
    }
  }

  private async save(data: LockData): Promise<void> {
    await mkdir(join(this.path, ".."), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`);
  }

  async recordInstall(name: string, entry: LockEntry): Promise<void> {
    const data = await this.load();
    data.installed[name] = entry;
    await this.save(data);
  }

  async recordUninstall(name: string): Promise<void> {
    const data = await this.load();
    delete data.installed[name];
    await this.save(data);
  }

  async get(name: string): Promise<LockEntry | undefined> {
    return (await this.load()).installed[name];
  }

  async list(): Promise<Array<LockEntry & { name: string }>> {
    const data = await this.load();
    return Object.entries(data.installed).map(([name, entry]) => ({ name, ...entry }));
  }
}

// ── Audit log (append-only record of hub actions) ───────────────────────────

export interface AuditEntry {
  timestamp: string;
  action: string;
  skill: string;
  source: string;
  verdict: string;
  extra: string;
}

export async function appendAudit(
  path: string,
  action: string,
  skill: string,
  source: string,
  verdict: string,
  extra = "",
): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const parts = [timestamp, action, skill, source, verdict];
  if (extra) {
    parts.push(extra);
  }
  await appendFile(path, `${parts.join(" ")}\n`);
}

export async function readAudit(path: string): Promise<AuditEntry[]> {
  if (!existsSync(path)) {
    return [];
  }
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
  return lines.map((line) => {
    const [timestamp = "", action = "", skill = "", source = "", verdict = "", ...rest] = line.split(" ");
    return { timestamp, action, skill, source, verdict, extra: rest.join(" ") };
  });
}

// ── Taps (custom GitHub repo sources) ───────────────────────────────────────

export interface Tap {
  repo: string;
  path: string;
}

export class TapsManager {
  constructor(private readonly path: string) {}

  async load(): Promise<Tap[]> {
    if (!existsSync(this.path)) {
      return [];
    }
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as { taps?: Tap[] };
      return data.taps ?? [];
    } catch {
      return [];
    }
  }

  private async save(taps: Tap[]): Promise<void> {
    await mkdir(join(this.path, ".."), { recursive: true });
    await writeFile(this.path, `${JSON.stringify({ taps }, null, 2)}\n`);
  }

  async add(repo: string, path = "skills/"): Promise<boolean> {
    const taps = await this.load();
    if (taps.some((t) => t.repo === repo)) {
      return false;
    }
    taps.push({ repo, path });
    await this.save(taps);
    return true;
  }

  async remove(repo: string): Promise<boolean> {
    const taps = await this.load();
    const next = taps.filter((t) => t.repo !== repo);
    if (next.length === taps.length) {
      return false;
    }
    await this.save(next);
    return true;
  }
}
