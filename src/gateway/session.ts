import { mkdir, readFile, appendFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEntry, SessionSource, StoredMessage } from "./types.js";
import { buildSessionKey } from "./platforms/base.js";
import type { SessionResetPolicy } from "./config.js";

function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const rand = Math.random().toString(16).slice(2, 10);
  return `${date}_${time}_${rand}`;
}

export function shouldReset(entry: SessionEntry, policy: SessionResetPolicy): "idle" | "daily" | null {
  if (policy.mode === "none") return null;

  const now = Date.now();

  if (policy.mode === "idle" || policy.mode === "both") {
    const idleDeadline = entry.updatedAt.getTime() + policy.idleMinutes * 60_000;
    if (now > idleDeadline) return "idle";
  }

  if (policy.mode === "daily" || policy.mode === "both") {
    const todayReset = new Date();
    todayReset.setHours(policy.atHour, 0, 0, 0);
    if (now >= todayReset.getTime() && entry.updatedAt.getTime() < todayReset.getTime()) {
      return "daily";
    }
  }

  return null;
}

export class SessionStore {
  private _entries = new Map<string, SessionEntry>();
  private _dir: string;
  private _loaded = false;

  constructor(sessionsDir: string) {
    this._dir = sessionsDir;
  }

  async _ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const content = await readFile(join(this._dir, "sessions.json"), "utf-8");
      const data = JSON.parse(content) as Record<string, unknown>;
      this._entries.clear();
      for (const [key, val] of Object.entries(data)) {
        const entry = entryFromJson(key, val);
        if (entry) this._entries.set(key, entry);
      }
    } catch {
      // No index file yet — fresh start
    }
  }

  async _save(): Promise<void> {
    await mkdir(this._dir, { recursive: true });
    const data: Record<string, unknown> = {};
    for (const [key, entry] of this._entries) {
      data[key] = entryToJson(entry);
    }
    await writeFile(join(this._dir, "sessions.json"), JSON.stringify(data, null, 2));
  }

  async getOrCreateSession(
    source: SessionSource,
    policy: SessionResetPolicy,
    groupSessionsPerUser: boolean,
  ): Promise<SessionEntry> {
    await this._ensureLoaded();
    const key = buildSessionKey(source, groupSessionsPerUser);
    let entry = this._entries.get(key);

    if (entry) {
      if (entry.suspended) {
        entry.suspended = false;
        entry.resumePending = true;
        entry.resumeReason = "restart";
      } else {
        const reason = shouldReset(entry, policy);
        if (reason) {
          entry = await this._createNew(key, source, reason);
        }
      }
    } else {
      entry = await this._createNew(key, source);
    }

    entry.updatedAt = new Date();
    await this._save();
    return entry;
  }

  private async _createNew(
    key: string,
    source: SessionSource,
    resetReason?: "idle" | "daily",
  ): Promise<SessionEntry> {
    const entry: SessionEntry = {
      sessionKey: key,
      sessionId: generateSessionId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      origin: source,
      platform: source.platform,
      chatType: source.chatType,
      ...(resetReason ? { wasAutoReset: true, autoResetReason: resetReason } : {}),
    };
    this._entries.set(key, entry);
    return entry;
  }

  async resetSession(sessionKey: string): Promise<SessionEntry | undefined> {
    await this._ensureLoaded();
    const old = this._entries.get(sessionKey);
    if (!old) return undefined;
    const fresh = await this._createNew(sessionKey, old.origin ?? _emptySource(old), undefined);
    fresh.isFreshReset = true;
    await this._save();
    return fresh;
  }

  async suspendSession(sessionKey: string): Promise<boolean> {
    await this._ensureLoaded();
    const entry = this._entries.get(sessionKey);
    if (!entry) return false;
    entry.suspended = true;
    await this._save();
    return true;
  }

  async clearResumePending(sessionKey: string): Promise<SessionEntry | undefined> {
    await this._ensureLoaded();
    const entry = this._entries.get(sessionKey);
    if (!entry) return undefined;
    entry.resumePending = false;
    entry.resumeReason = undefined;
    await this._save();
    return entry;
  }

  getSession(sessionKey: string): SessionEntry | undefined {
    return this._entries.get(sessionKey);
  }

  listSessions(): SessionEntry[] {
    return [...this._entries.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async appendToTranscript(sessionId: string, message: StoredMessage): Promise<void> {
    const file = join(this._dir, `${sessionId}.jsonl`);
    const line = JSON.stringify({ ...message, timestamp: new Date().toISOString() }) + "\n";
    await mkdir(this._dir, { recursive: true });
    await appendFile(file, line, "utf-8");
  }

  async loadTranscript(sessionId: string): Promise<StoredMessage[]> {
    const file = join(this._dir, `${sessionId}.jsonl`);
    try {
      const content = await readFile(file, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StoredMessage);
    } catch {
      return [];
    }
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const entry = this._entries.get(sessionKey);
    if (!entry) return;
    this._entries.delete(sessionKey);
    await rm(join(this._dir, `${entry.sessionId}.jsonl`), { force: true });
    await this._save();
  }
}

function _emptySource(entry: SessionEntry): SessionSource {
  return {
    platform: entry.platform ?? "unknown",
    chatId: "",
    chatType: (entry.chatType as SessionSource["chatType"]) ?? "dm",
  };
}

function entryFromJson(key: string, data: unknown): SessionEntry | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  return {
    sessionKey: key,
    sessionId: String(d.sessionId ?? ""),
    createdAt: d.createdAt ? new Date(String(d.createdAt)) : new Date(),
    updatedAt: d.updatedAt ? new Date(String(d.updatedAt)) : new Date(),
    origin: d.origin as SessionSource | undefined,
    platform: d.platform ? String(d.platform) : undefined,
    chatType: d.chatType ? String(d.chatType) : undefined,
    wasAutoReset: typeof d.wasAutoReset === "boolean" ? d.wasAutoReset : undefined,
    autoResetReason: d.autoResetReason as SessionEntry["autoResetReason"],
    isFreshReset: typeof d.isFreshReset === "boolean" ? d.isFreshReset : undefined,
    suspended: typeof d.suspended === "boolean" ? d.suspended : undefined,
    resumePending: typeof d.resumePending === "boolean" ? d.resumePending : undefined,
    resumeReason: d.resumeReason ? String(d.resumeReason) : undefined,
  };
}

function entryToJson(entry: SessionEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sessionId: entry.sessionId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
  if (entry.origin) out.origin = entry.origin;
  if (entry.platform) out.platform = entry.platform;
  if (entry.chatType) out.chatType = entry.chatType;
  if (entry.wasAutoReset !== undefined) out.wasAutoReset = entry.wasAutoReset;
  if (entry.autoResetReason) out.autoResetReason = entry.autoResetReason;
  if (entry.isFreshReset !== undefined) out.isFreshReset = entry.isFreshReset;
  if (entry.suspended !== undefined) out.suspended = entry.suspended;
  if (entry.resumePending !== undefined) out.resumePending = entry.resumePending;
  if (entry.resumeReason) out.resumeReason = entry.resumeReason;
  return out;
}
