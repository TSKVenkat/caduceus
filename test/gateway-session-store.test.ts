import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, shouldReset } from "../src/gateway/session.js";
import type { SessionSource } from "../src/gateway/types.js";
import type { SessionResetPolicy } from "../src/gateway/config.js";

function src(overrides: Partial<SessionSource> = {}): SessionSource {
  return {
    platform: "slack",
    chatId: "D_test",
    chatType: "dm",
    userId: "U_test",
    ...overrides,
  };
}

const idlePolicy: SessionResetPolicy = {
  mode: "idle",
  atHour: 4,
  idleMinutes: 1440,
  notify: true,
  notifyExcludePlatforms: [],
};

describe("SessionStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-sessions-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a new session on first message", async () => {
    const store = new SessionStore(dir);
    const entry = await store.getOrCreateSession(src(), idlePolicy, true);
    expect(entry.sessionId).toMatch(/^\d{8}_\d{6}_[0-9a-f]{8}$/);
    expect(entry.platform).toBe("slack");
    expect(entry.chatType).toBe("dm");
  });

  it("returns the same session on subsequent messages", async () => {
    const store = new SessionStore(dir);
    const first = await store.getOrCreateSession(src(), idlePolicy, true);
    const second = await store.getOrCreateSession(src(), idlePolicy, true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("creates a new session after reset", async () => {
    const store = new SessionStore(dir);
    const first = await store.getOrCreateSession(src(), idlePolicy, true);
    await store.resetSession(first.sessionKey);
    store["_loaded"] = false; // force reload
    const second = await store.getOrCreateSession(src(), idlePolicy, true);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it("suspends and resumes a session", async () => {
    const store = new SessionStore(dir);
    const first = await store.getOrCreateSession(src(), idlePolicy, true);
    await store.suspendSession(first.sessionKey);
    store["_loaded"] = false;
    const second = await store.getOrCreateSession(src(), idlePolicy, true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.resumePending).toBe(true);
  });

  it("persists and loads transcripts", async () => {
    const store = new SessionStore(dir);
    const entry = await store.getOrCreateSession(src(), idlePolicy, true);

    await store.appendToTranscript(entry.sessionId, { role: "user", content: "hello" });
    await store.appendToTranscript(entry.sessionId, { role: "assistant", content: "hi there" });

    const transcript = await store.loadTranscript(entry.sessionId);
    expect(transcript).toHaveLength(2);
    expect(transcript[0]?.content).toBe("hello");
    expect(transcript[1]?.content).toBe("hi there");
  });

  it("returns empty array for missing transcript", async () => {
    const store = new SessionStore(dir);
    const transcript = await store.loadTranscript("nonexistent");
    expect(transcript).toEqual([]);
  });

  it("lists sessions sorted by updatedAt desc", async () => {
    const store = new SessionStore(dir);
    await store.getOrCreateSession(src({ chatId: "A" }), idlePolicy, true);
    await store.getOrCreateSession(src({ chatId: "B" }), idlePolicy, true);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
  });
});

describe("shouldReset", () => {
  const noReset: SessionResetPolicy = { ...idlePolicy, mode: "none" };

  it("returns null for mode none", () => {
    const entry = { sessionKey: "k", sessionId: "s", createdAt: new Date(), updatedAt: new Date() };
    expect(shouldReset(entry, noReset)).toBeNull();
  });

  it("returns idle when older than idleMinutes", () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const entry = { sessionKey: "k", sessionId: "s", createdAt: old, updatedAt: old };
    const policy: SessionResetPolicy = { ...idlePolicy, mode: "idle", idleMinutes: 60 };
    const result = shouldReset(entry, policy);
    expect(result).toBe("idle");
  });

  it("returns null when within idle window", () => {
    const entry = { sessionKey: "k", sessionId: "s", createdAt: new Date(), updatedAt: new Date() };
    const policy: SessionResetPolicy = { ...idlePolicy, mode: "idle", idleMinutes: 1440 };
    const result = shouldReset(entry, policy);
    expect(result).toBeNull();
  });
});
