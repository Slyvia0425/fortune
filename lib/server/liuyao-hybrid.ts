import { authenticatedFetch } from "./module4-auth";

export class HybridServiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callHybrid<T>(path: string, body: unknown): Promise<T> {
  const response = await authenticatedFetch(`/api/v1/liuyao/hybrid/${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
  });
  if (!response) throw new HybridServiceError(401, "请先登录后起卦或读取解释。");
  if (!response.ok) {
    const message = response.status === 404 ? "未找到属于当前账户的冻结卦盘，请从本账户的起卦结果进入。"
      : response.status === 401 ? "登录已失效，请重新登录。"
      : response.status === 422 ? "起卦输入无效，或请求编号与原输入不一致。"
      : "卦盘与检索服务暂不可用，请稍后重试。";
    throw new HybridServiceError(response.status, message);
  }
  const payload = await response.json();
  if (!payload.result) throw new HybridServiceError(502, "检索服务未返回有效结果。");
  return payload.result as T;
}
