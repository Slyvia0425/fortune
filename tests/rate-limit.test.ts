import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter, positiveNumber } from "@/lib/server/rate-limit";

describe("createRateLimiter", () => {
  it("lets a client through up to the limit, then says how long to wait", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 1_000).allowed).toBe(true);
    const third = limiter.take("a", 2_000);
    expect(third).toEqual({ allowed: false, retryAfterSeconds: 58 });
  });

  it("counts each client on its own and frees the window as it passes", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 });
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("b", 0).allowed).toBe(true);
    expect(limiter.take("a", 5_000).allowed).toBe(false);
    expect(limiter.take("a", 10_001).allowed).toBe(true);
  });

  it("does not count a refused request against the client", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 });
    limiter.take("a", 0);
    for (let at = 1_000; at < 9_000; at += 1_000) limiter.take("a", at);
    expect(limiter.take("a", 10_001).allowed).toBe(true);
  });
});

describe("clientKey and positiveNumber", () => {
  it("takes the first forwarded address, then the real address, then a shared bucket", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientKey(new Request("http://x"))).toBe("local");
  });

  it("falls back for settings that are missing or not positive numbers", () => {
    expect(positiveNumber(undefined, 12)).toBe(12);
    expect(positiveNumber("0", 12)).toBe(12);
    expect(positiveNumber("abc", 12)).toBe(12);
    expect(positiveNumber("30", 12)).toBe(30);
  });
});
