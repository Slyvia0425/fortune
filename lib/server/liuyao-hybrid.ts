import { cookies } from "next/headers";
import { module4BaseUrl, sessionToken } from "./module4-auth";

export const DIVINATION_SESSION_COOKIE = "fortune_divination_session";

async function hybridFetch(path: string, init: RequestInit) {
  const token = await sessionToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    const cookieStore = await cookies();
    let anonymousSession = cookieStore.get(DIVINATION_SESSION_COOKIE)?.value;
    if (!anonymousSession) {
      anonymousSession = crypto.randomUUID();
      cookieStore.set(DIVINATION_SESSION_COOKIE, anonymousSession, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    headers.set("X-Anonymous-Session", anonymousSession);
  }
  return fetch(`${module4BaseUrl()}/api/v1/liuyao/hybrid/${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
}

export class HybridServiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callHybrid<T>(path: string, body: unknown): Promise<T> {
  const response = await hybridFetch(path, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const message = response.status === 404 ? "未找到属于当前会话的冻结卦盘，请重新起卦。"
      : response.status === 401 ? "起卦会话已失效，请刷新页面后重试。"
      : response.status === 422 ? "起卦输入无效，或请求编号与原输入不一致。"
      : "卦盘与检索服务暂不可用，请稍后重试。";
    throw new HybridServiceError(response.status, message);
  }
  const payload = await response.json();
  if (!payload.result) throw new HybridServiceError(502, "检索服务未返回有效结果。");
  return payload.result as T;
}
