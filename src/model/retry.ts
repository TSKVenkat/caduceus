const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryOptions {
  /** Total attempts (including the first). */
  attempts: number;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs: number;
  /** Base backoff in milliseconds (doubles per attempt, plus jitter). */
  baseDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * `fetch` with bounded exponential backoff on network errors and retryable HTTP
 * statuses (408/429/5xx), plus a per-attempt timeout. Honors `Retry-After`, and
 * never retries when the caller's signal aborted (that's a cancellation).
 * `doFetch` is injectable for testing.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  options: RetryOptions,
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const base = options.baseDelayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 0; attempt < options.attempts; attempt++) {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await doFetch(url, { ...init, signal: controller.signal });
      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt === options.attempts - 1) {
        return response;
      }
      await delay(backoff(base, attempt, response.headers.get("retry-after")));
    } catch (error) {
      if (options.signal?.aborted) {
        throw error; // caller cancelled — do not retry
      }
      lastError = error;
      if (attempt === options.attempts - 1) {
        throw error;
      }
      await delay(backoff(base, attempt, null));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError ?? new Error("request failed after retries");
}

function backoff(base: number, attempt: number, retryAfter: string | null): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  return base * 2 ** attempt + Math.floor(Math.random() * base);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
