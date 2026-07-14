import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PairingStore } from "../src/gateway/pairing.js";

describe("PairingStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-pairing-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates an 8-char code from the unambiguous alphabet", async () => {
    const store = new PairingStore(dir);
    const code = await store.generateCode("slack", "U1", "Alice");
    expect(code).not.toBeNull();
    expect(code).toHaveLength(8);
    expect(code!).toMatch(/^[A-Z2-9]+$/);
    expect(code!).not.toMatch(/[01IO]/);
  });

  it("approves a valid code and marks user as approved", async () => {
    const store = new PairingStore(dir);
    const code = await store.generateCode("slack", "U1", "Alice");
    expect(code).not.toBeNull();

    const result = await store.approveCode("slack", code!);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("U1");

    const approved = await store.isApproved("slack", "U1");
    expect(approved).toBe(true);
  });

  it("rejects an invalid code", async () => {
    const store = new PairingStore(dir);
    const result = await store.approveCode("slack", "WRONG123");
    expect(result).toBeNull();
  });

  it("revokes an approved user", async () => {
    const store = new PairingStore(dir);
    const code = await store.generateCode("slack", "U1");
    await store.approveCode("slack", code!);

    const revoked = await store.revoke("slack", "U1");
    expect(revoked).toBe(true);
    expect(await store.isApproved("slack", "U1")).toBe(false);
  });

  it("rate-limits repeated code generation for the same user", async () => {
    const store = new PairingStore(dir);
    const first = await store.generateCode("slack", "U1");
    expect(first).not.toBeNull();
    const second = await store.generateCode("slack", "U1");
    expect(second).toBeNull();
  });
});
