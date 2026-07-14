import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_TTL_MS = 3600_000;
const RATE_LIMIT_MS = 600_000;
const LOCKOUT_MS = 3600_000;
const MAX_PENDING = 3;
const MAX_FAILED = 5;

interface PendingEntry {
  code: string;
  userId: string;
  userName: string;
  createdAt: number;
}

interface ApprovedEntry {
  userName: string;
  approvedAt: number;
}

export class PairingStore {
  private _dir: string;
  private _lock = Promise.resolve();

  constructor(dir?: string) {
    this._dir = dir ?? join(process.env.CADUCEUS_HOME ?? join(homedir(), ".caduceus"), "pairing");
  }

  async generateCode(platform: string, userId: string, userName = ""): Promise<string | null> {
    return this._lock.then(async () => {
      await this._cleanupExpired(platform);

      const rateLimits = await this._loadRateLimits();
      const rateKey = `${platform}:${userId}`;
      if (rateLimits[rateKey] && Date.now() - rateLimits[rateKey] < RATE_LIMIT_MS) return null;

      const lockoutKey = `_lockout:${platform}`;
      if (rateLimits[lockoutKey] && Date.now() < rateLimits[lockoutKey]) return null;

      const pending = await this._loadPending(platform);
      if (pending.length >= MAX_PENDING) return null;

      const code = generateSecureCode();
      pending.push({ code, userId, userName, createdAt: Date.now() });
      await this._savePending(platform, pending);

      rateLimits[rateKey] = Date.now();
      await this._saveRateLimits(rateLimits);

      return code;
    });
  }

  async approveCode(platform: string, code: string): Promise<{ userId: string; userName: string } | null> {
    const pending = await this._loadPending(platform);
    const normalized = code.toUpperCase().trim();
    const idx = pending.findIndex((e) => e.code === normalized);
    if (idx === -1) {
      await this._recordFailure(platform);
      return null;
    }

    const removed = pending.splice(idx, 1);
    const entry = removed[0];
    if (!entry) return null;
    await this._savePending(platform, pending);

    const approved = await this._loadApproved(platform);
    approved[entry.userId] = { userName: entry.userName, approvedAt: Date.now() };
    await this._saveApproved(platform, approved);

    return { userId: entry.userId, userName: entry.userName };
  }

  async isApproved(platform: string, userId: string): Promise<boolean> {
    const approved = await this._loadApproved(platform);
    return userId in approved;
  }

  async revoke(platform: string, userId: string): Promise<boolean> {
    const approved = await this._loadApproved(platform);
    if (!(userId in approved)) return false;
    delete approved[userId];
    await this._saveApproved(platform, approved);
    return true;
  }

  async listApproved(platform?: string): Promise<Array<{ platform: string; userId: string; userName: string }>> {
    if (platform) {
      const approved = await this._loadApproved(platform);
      return Object.entries(approved).map(([userId, e]) => ({ platform, userId, userName: e.userName }));
    }
    // List across all platforms — would need directory scan; stub for now
    return [];
  }

  private async _loadPending(platform: string): Promise<PendingEntry[]> {
    try {
      const content = await readFile(join(this._dir, `${platform}-pending.json`), "utf-8");
      return JSON.parse(content) as PendingEntry[];
    } catch {
      return [];
    }
  }

  private async _savePending(platform: string, entries: PendingEntry[]): Promise<void> {
    await mkdir(this._dir, { recursive: true });
    await writeFile(join(this._dir, `${platform}-pending.json`), JSON.stringify(entries, null, 2));
  }

  private async _loadApproved(platform: string): Promise<Record<string, ApprovedEntry>> {
    try {
      const content = await readFile(join(this._dir, `${platform}-approved.json`), "utf-8");
      return JSON.parse(content) as Record<string, ApprovedEntry>;
    } catch {
      return {};
    }
  }

  private async _saveApproved(platform: string, approved: Record<string, ApprovedEntry>): Promise<void> {
    await mkdir(this._dir, { recursive: true });
    await writeFile(join(this._dir, `${platform}-approved.json`), JSON.stringify(approved, null, 2));
  }

  private async _loadRateLimits(): Promise<Record<string, number>> {
    try {
      const content = await readFile(join(this._dir, "_rate_limits.json"), "utf-8");
      return JSON.parse(content) as Record<string, number>;
    } catch {
      return {};
    }
  }

  private async _saveRateLimits(limits: Record<string, number>): Promise<void> {
    await mkdir(this._dir, { recursive: true });
    await writeFile(join(this._dir, "_rate_limits.json"), JSON.stringify(limits, null, 2));
  }

  private async _recordFailure(platform: string): Promise<void> {
    const limits = await this._loadRateLimits();
    const failKey = `_failures:${platform}`;
    limits[failKey] = (limits[failKey] ?? 0) + 1;
    if (limits[failKey] >= MAX_FAILED) {
      limits[`_lockout:${platform}`] = Date.now() + LOCKOUT_MS;
      delete limits[failKey];
    }
    await this._saveRateLimits(limits);
  }

  private async _cleanupExpired(platform: string): Promise<void> {
    const pending = await this._loadPending(platform);
    const fresh = pending.filter((e) => Date.now() - e.createdAt < CODE_TTL_MS);
    if (fresh.length !== pending.length) {
      await this._savePending(platform, fresh);
    }
  }
}

function generateSecureCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return code;
}
