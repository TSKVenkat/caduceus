import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decideInstall, type ScanResult } from "./scanner";
import { appendAudit, ensureHubDirs, HubLock, type HubPaths } from "./state";
import type { SkillBundle } from "./types";

const SAFE_SEGMENT = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/** Reject names that could escape the skills directory or are otherwise unsafe. */
export function validateSkillName(name: string): string {
  if (!SAFE_SEGMENT.test(name) || name === "." || name === "..") {
    throw new Error(`Unsafe skill name: ${JSON.stringify(name)}`);
  }
  return name;
}

export function validateCategory(category: string): string {
  if (category === "") {
    return "";
  }
  return validateSkillName(category);
}

/** Validate a bundle-relative file path: POSIX, no traversal, no absolute paths. */
export function validateRelPath(rel: string): string {
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error(`Unsafe bundle path: ${JSON.stringify(rel)}`);
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((seg) => !SAFE_SEGMENT.test(seg))) {
    throw new Error(`Unsafe bundle path: ${JSON.stringify(rel)}`);
  }
  return parts.join("/");
}

/** Deterministic content hash of a bundle's files (sorted by path). */
export function bundleContentHash(bundle: SkillBundle): string {
  const hash = createHash("sha256");
  for (const rel of Object.keys(bundle.files).sort()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(bundle.files[rel] ?? "");
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex").slice(0, 16)}`;
}

/** Write a bundle's validated files into the quarantine directory for scanning. */
export async function quarantineBundle(paths: HubPaths, bundle: SkillBundle): Promise<string> {
  await ensureHubDirs(paths);
  const name = validateSkillName(bundle.name);
  const validated = Object.entries(bundle.files).map(([rel, content]) => [validateRelPath(rel), content] as const);
  if (!validated.some(([rel]) => rel === "SKILL.md")) {
    throw new Error(`Bundle '${name}' has no SKILL.md`);
  }

  const dest = join(paths.quarantineDir, name);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  for (const [rel, content] of validated) {
    const target = join(dest, ...rel.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  return dest;
}

export interface InstallOutcome {
  installPath: string;
  contentHash: string;
}

/**
 * Promote a scanned bundle from quarantine into the skills directory, then
 * record provenance in the lock file and the audit log. Installs flat (one
 * directory per skill) so the existing skill loader discovers it; category is
 * retained as metadata only.
 */
export async function installFromQuarantine(
  paths: HubPaths,
  bundle: SkillBundle,
  scan: ScanResult,
  force = false,
): Promise<InstallOutcome> {
  const decision = decideInstall(scan, force);
  if (decision.decision !== "allow") {
    throw new Error(decision.reason);
  }

  const name = validateSkillName(bundle.name);
  const category = validateCategory(bundle.category ?? "");
  const quarantine = join(paths.quarantineDir, name);
  if (!existsSync(quarantine)) {
    throw new Error(`Nothing in quarantine for '${name}'`);
  }
  // Defence in depth: never let the resolved quarantine path escape its root.
  if (!resolve(quarantine).startsWith(resolve(paths.quarantineDir))) {
    throw new Error(`Unsafe quarantine path for '${name}'`);
  }

  const installPath = join(paths.skillsDir, name);
  await rm(installPath, { recursive: true, force: true });
  await mkdir(join(installPath, ".."), { recursive: true });

  const files = Object.keys(bundle.files).map((rel) => validateRelPath(rel));
  for (const rel of files) {
    const target = join(installPath, ...rel.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, bundle.files[rel] ?? "");
  }
  await rm(quarantine, { recursive: true, force: true });

  const contentHash = bundleContentHash(bundle);
  await new HubLock(paths.lockFile).recordInstall(name, {
    source: bundle.source,
    identifier: bundle.identifier,
    trustLevel: bundle.trustLevel,
    scanVerdict: scan.verdict,
    contentHash,
    installPath: name,
    category,
    files,
    installedAt: new Date().toISOString(),
  });
  await appendAudit(paths.auditLog, "INSTALL", name, `${bundle.source}:${bundle.trustLevel}`, scan.verdict, contentHash);

  return { installPath, contentHash };
}

/** Remove a hub-installed skill. Refuses to touch skills not recorded in the lock. */
export async function uninstallSkill(paths: HubPaths, name: string): Promise<string> {
  const safe = validateSkillName(name);
  const lock = new HubLock(paths.lockFile);
  const entry = await lock.get(safe);
  if (!entry) {
    throw new Error(`'${safe}' is not a hub-installed skill (it may be a builtin)`);
  }
  await rm(join(paths.skillsDir, entry.installPath), { recursive: true, force: true });
  await lock.recordUninstall(safe);
  await appendAudit(paths.auditLog, "UNINSTALL", safe, `${entry.source}:${entry.trustLevel}`, "n/a", "user_request");
  return `Uninstalled '${safe}'`;
}
