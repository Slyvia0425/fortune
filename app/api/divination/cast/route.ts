import type { DivinationCastResult } from "@/lib/contracts/divination";
import { failure, record, success } from "@/lib/contracts/api";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try { body = record(await request.json()); } catch {}
  if (!body || typeof body.question !== "string" || !body.question.trim() || body.question.length > 500
    || body.method !== "three_numbers" || !Array.isArray(body.numbers) || body.numbers.length !== 3
    || !body.numbers.every(n => Number.isSafeInteger(n) && n > 0)) {
    return failure("divination-cast-v3", "VALIDATION_ERROR", "请提供问题和三个正整数。", undefined, 422);
  }
  try {
    const data = await callHybrid<DivinationCastResult>("cast", {
      question: body.question, numbers: body.numbers,
      request_id: body.request_id ?? crypto.randomUUID(), timezone: body.timezone ?? "Asia/Shanghai",
    });
    return Response.json(success(data, { system: "divination-cast-v3", sessionId: data.core_receipt?.request_id }));
  } catch (error) {
    return failure("divination-cast-v3", "CAST_SERVICE_ERROR",
      error instanceof HybridServiceError ? error.message : "起卦服务暂不可用。",
      undefined, error instanceof HybridServiceError ? error.status : 502);
  }
}
