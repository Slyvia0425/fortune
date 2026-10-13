import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  token: null as string | null,
  cookies: new Map<string, string>(),
  setCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = state.cookies.get(name);
      return value ? { value } : undefined;
    },
    set: (name: string, value: string, options: unknown) => {
      state.cookies.set(name, value);
      state.setCookie(name, value, options);
    },
  }),
}));

vi.mock("../lib/server/module4-auth", () => ({
  module4BaseUrl: () => "http://module4.test",
  sessionToken: async () => state.token,
}));

import {
  callHybrid,
  DIVINATION_SESSION_COOKIE,
} from "../lib/server/liuyao-hybrid";

describe("hybrid divination session", () => {
  beforeEach(() => {
    state.token = null;
    state.cookies.clear();
    state.setCookie.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { chart_id: "chart-1" } }),
    }));
  });

  it("creates and reuses an anonymous session when logged out", async () => {
    await callHybrid("cast", { numbers: [3, 5, 8] });
    await callHybrid("evidence", { chart_id: "chart-1" });

    expect(state.setCookie).toHaveBeenCalledTimes(1);
    const anonymousSession = state.cookies.get(DIVINATION_SESSION_COOKIE);
    expect(anonymousSession).toMatch(/^[0-9a-f-]{36}$/);
    const fetchMock = vi.mocked(fetch);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("X-Anonymous-Session")).toBe(anonymousSession);
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    }
  });

  it("keeps account identity for a logged-in user", async () => {
    state.token = "session-token";
    await callHybrid("cast", { numbers: [3, 5, 8] });

    expect(state.setCookie).not.toHaveBeenCalled();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-token");
    expect(new Headers(init?.headers).has("X-Anonymous-Session")).toBe(false);
  });
});
