import { describe, it, expect } from "vitest";
import { buildSessionKey, isControlCommand } from "../src/gateway/platforms/base.js";
import type { SessionSource } from "../src/gateway/types.js";

function src(overrides: Partial<SessionSource> = {}): SessionSource {
  return {
    platform: "slack",
    chatId: "C123",
    chatType: "dm",
    userId: "U123",
    ...overrides,
  };
}

describe("buildSessionKey", () => {
  it("builds a DM key with chatId", () => {
    const key = buildSessionKey(src({ chatType: "dm", chatId: "D1" }));
    expect(key).toBe("agent:main:slack:dm:D1");
  });

  it("includes threadId for DMs when present", () => {
    const key = buildSessionKey(src({ chatType: "dm", chatId: "D1", threadId: "T1" }));
    expect(key).toBe("agent:main:slack:dm:D1:T1");
  });

  it("appends userId for groups when groupSessionsPerUser", () => {
    const key = buildSessionKey(src({ chatType: "group", chatId: "C1", userId: "U1" }), true);
    expect(key).toBe("agent:main:slack:group:C1:U1");
  });

  it("omits userId for groups when not per-user", () => {
    const key = buildSessionKey(src({ chatType: "group", chatId: "C1", userId: "U1" }), false);
    expect(key).toBe("agent:main:slack:group:C1");
  });

  it("includes threadId before userId for threaded groups", () => {
    const key = buildSessionKey(
      src({ chatType: "group", chatId: "C1", threadId: "T1", userId: "U1" }),
      true,
      true,
    );
    expect(key).toBe("agent:main:slack:group:C1:T1:U1");
  });
});

describe("isControlCommand", () => {
  it("detects /stop", () => {
    expect(isControlCommand("/stop")).toBe(true);
    expect(isControlCommand("  /stop  ")).toBe(true);
  });

  it("detects /new and /reset", () => {
    expect(isControlCommand("/new")).toBe(true);
    expect(isControlCommand("/reset")).toBe(true);
  });

  it("detects /approve and /deny", () => {
    expect(isControlCommand("/approve once")).toBe(true);
    expect(isControlCommand("/deny")).toBe(true);
  });

  it("does not flag regular messages", () => {
    expect(isControlCommand("hello world")).toBe(false);
    expect(isControlCommand("stop that")).toBe(false);
    expect(isControlCommand("")).toBe(false);
  });
});
