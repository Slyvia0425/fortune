import { cookies } from "next/headers";
import { module4BaseUrl, sessionToken } from "./module4-auth";
import { internalSecret, signInternalRequest } from "./divination-signature";
import { workflowFetch } from "./workflow-budget";
import { traceNode } from "./case-trace";

export const DIVINATION_SESSION_COOKIE = "fortune_divination_session";

async function hybridFetch(path: string, init: RequestInit, trusted = false) {
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
  if (trusted) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const identity = headers.get("Authorization") ?? headers.get("X-Anonymous-Session") ?? "";
    headers.set("X-Divination-Timestamp", timestamp);
    headers.set("X-Divination-Signature", signInternalRequest(await internalSecret(), path, timestamp, identity, String(init.body)));
  }
  return workflowFetch(`${module4BaseUrl()}/api/v1/liuyao/hybrid/${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
}

export class HybridServiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callHybrid<T>(path: string, body: unknown, trusted = false): Promise<T> {
  return traceNode(`backend-${path}`,body,()=>callHybridImpl<T>(path,body,trusted));
}
async function callHybridImpl<T>(path: string, body: unknown, trusted = false): Promise<T> {
  const response = await hybridFetch(path, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(path === "source-evidence" ? 240_000 : 90_000),
  }, trusted);
  if (!response.ok) {
    const message = response.status === 404 ? "未找到属于当前会话的冻结卦盘，请重新起卦。"
      : response.status === 401 ? "起卦会话已失效，请刷新页面后重试。"
      : response.status === 422 ? "起卦输入无效，或请求编号与原输入不一致。"
      : response.status === 409 ? "问事版本已更新或确认记录不一致，请重新读取当前问题。"
      : response.status === 403 ? "请先确认当前问题，再起卦。"
      : response.status === 410 ? "旧起卦入口已停用，请通过对话确认问题后起卦。"
      : "卦盘与检索服务暂不可用，请稍后重试。";
    throw new HybridServiceError(response.status, message);
  }
  const payload = await response.json();
  if (!payload.result) throw new HybridServiceError(502, "检索服务未返回有效结果。");
  return payload.result as T;
}
