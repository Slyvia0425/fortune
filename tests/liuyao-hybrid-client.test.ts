import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInternalRequest } from "../lib/server/divination-signature";

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
  afterEach(()=>vi.unstubAllEnvs());
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
    await callHybrid("cast", { confirmation_id:"00000000-0000-0000-0000-000000000001",request_id:"00000000-0000-0000-0000-000000000001" });
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
    await callHybrid("cast", { confirmation_id:"00000000-0000-0000-0000-000000000001",request_id:"00000000-0000-0000-0000-000000000001" });

    expect(state.setCookie).not.toHaveBeenCalled();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-token");
    expect(new Headers(init?.headers).has("X-Anonymous-Session")).toBe(false);
  });
  it("候选写入签名绑定身份、路径和完整请求体",async()=>{
    const secret="test-private-bridge-key-0123456789012345";
    vi.stubEnv("DIVINATION_INTERNAL_SECRET",secret);
    await callHybrid("dialogue-save",{conversation_id:"draft",candidate:{question:"测试"}},true);
    const [,init]=vi.mocked(fetch).mock.calls[0];
    const headers=new Headers(init?.headers);
    const stamp=headers.get("X-Divination-Timestamp")!;
    const identity=headers.get("X-Anonymous-Session")!;
    const signature=headers.get("X-Divination-Signature");
    expect(signature).toBe(signInternalRequest(secret,"dialogue-save",stamp,identity,String(init?.body)));
    expect(signature).not.toBe(signInternalRequest(secret,"confirm",stamp,identity,String(init?.body)));
    expect(signature).not.toBe(signInternalRequest(secret,"dialogue-save",stamp,"other",String(init?.body)));
  });
});
