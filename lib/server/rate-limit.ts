/**
 * A small fixed-window limiter kept in the memory of one server process: enough to stop a single client from running up model calls on a
 * one-machine deployment. It is not shared between processes and starts again with each restart.
 */
export interface RateLimiter {
  /** Counts one request for `key`; says whether it is allowed and, if not, how long until the window frees up. */
  take(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number };
}

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }): RateLimiter {
  const seen = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      // A key that stopped asking is dropped from time to time, so the map cannot grow without bound.
      if (seen.size > 2000) {
        for (const [other, times] of seen) if (times.every((time) => now - time >= windowMs)) seen.delete(other);
      }
      const recent = (seen.get(key) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      seen.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** Who is asking: the first address the proxy forwarded, else a shared bucket for requests that carry none (local development). */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

export function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
