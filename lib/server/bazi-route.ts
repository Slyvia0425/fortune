import { failure, record } from "@/lib/contracts/api";
import type { BaziChartRequest } from "@/lib/contracts/bazi";
import { parseRequest } from "@/lib/bazi/request";

/**
 * Reading and validating a birth request from a route's body, and turning a failed call to the Python service into the response the
 * client expects.
 */

/** The validated birth request in the body, or the error response to return. */
export async function readBirthRequest(
  request: Request,
  system: string,
): Promise<{ ok: true; value: BaziChartRequest } | { ok: false; response: Response }> {
  let body: Record<string, unknown> | null = null;
  try {
    body = record(await request.json());
  } catch {
    // INVALID_JSON below
  }
  if (!body) return { ok: false, response: failure(system, "INVALID_JSON", "请求体必须是 JSON 对象。") };
  const parsed = parseRequest(body);
  if (!parsed.ok) return { ok: false, response: failure(system, "VALIDATION_ERROR", parsed.message) };
  return { ok: true, value: parsed.value };
}

/** 503 when the Python service is not configured, 502 for any other failure of the call. */
export function algorithmFailure(system: string, error: unknown): Response {
  if (error instanceof Error && error.message === "PYTHON_SERVICE_NOT_CONFIGURED") {
    return failure(system, "ALGORITHM_SERVICE_NOT_CONFIGURED", "八字算法服务未配置，请设置 PYTHON_ALGORITHM_BASE_URL 并启动 Python 服务。", undefined, 503);
  }
  return failure(system, "ALGORITHM_SERVICE_ERROR", "Python 八字服务调用失败。", { cause: error instanceof Error ? error.message : "unknown" }, 502);
}
