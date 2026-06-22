import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "../src/model/retry";

const resp = (status: number): Response => new Response(status === 200 ? "ok" : "err", { status });
const opts = { attempts: 3, timeoutMs: 1000, baseDelayMs: 1 };

describe("fetchWithRetry", () => {
  it("retries retryable statuses then succeeds", async () => {
    let calls = 0;
    const doFetch = (async () => {
      calls += 1;
      return resp(calls < 3 ? 429 : 200);
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("http://x", {}, opts, doFetch);
    expect(calls).toBe(3);
    expect(res.status).toBe(200);
  });

  it("does not retry non-retryable statuses", async () => {
    let calls = 0;
    const doFetch = (async () => {
      calls += 1;
      return resp(400);
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("http://x", {}, opts, doFetch);
    expect(calls).toBe(1);
    expect(res.status).toBe(400);
  });

  it("retries network errors then throws after exhausting attempts", async () => {
    let calls = 0;
    const doFetch = (async () => {
      calls += 1;
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      fetchWithRetry("http://x", {}, { ...opts, attempts: 2 }, doFetch),
    ).rejects.toThrow("network down");
    expect(calls).toBe(2);
  });
});
