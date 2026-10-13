import { failure, record, text } from "@/lib/contracts/api";
import type { SessionEventRequest } from "@/lib/contracts/user";
import { authenticatedFetch } from "@/lib/server/module4-auth";

const eventTypeMap: Record<string, string> = {
  question: "frontend.question.asked",
  supplement: "frontend.supplement.added",
  calculation: "frontend.calculation.completed",
  interpretation: "frontend.interpretation.viewed",
  visualization: "frontend.visualization.viewed",
  knowledge_read: "knowledge.item.opened",
  feedback: "feedback.submitted",
};
const modules = new Set(["bazi", "divination", "guanyin", "knowledge"]);
const eventTypes = new Set([
  ...Object.keys(eventTypeMap),
  "module2a.chat.user_message",
  "module2a.chat.assistant_message",
  "module2a.divination.completed",
  "conversation.message",
]);

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    body = record(await request.json());
  } catch {}
  if (!body) return failure("session-event-v2", "INVALID_JSON", "请求体必须是 JSON 对象。");

  const session_id = text(body.session_id, 36);
  const event_type = text(body.event_type, 128);
  const moduleName = text(body.module, 32);
  if (!session_id || !eventTypes.has(event_type) || !modules.has(moduleName)) {
    return failure("session-event-v2", "VALIDATION_ERROR", "session_id、event_type 或 module 无效。");
  }

  const eventId = text(body.event_id, 36) || crypto.randomUUID();
  const input: SessionEventRequest = {
    session_id,
    event_id: eventId,
    event_type,
    module: moduleName as SessionEventRequest["module"],
    payload: record(body.payload) ?? {},
    occurred_at: text(body.occurred_at, 40) || new Date().toISOString(),
    sequence_no: typeof body.sequence_no === "number" && Number.isSafeInteger(body.sequence_no) && body.sequence_no > 0 ? body.sequence_no : undefined,
  };

  let response: Response | null;
  try {
    response = await authenticatedFetch("/api/v1/events/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Idempotency-Key": eventId },
      body: JSON.stringify({
        event_id: input.event_id,
        session_id: input.session_id,
        source_module: input.module === "divination" ? "module2a" : `frontend-${input.module}`,
        event_type: eventTypeMap[input.event_type] ?? input.event_type,
        sequence_no: input.sequence_no,
        occurred_at: input.occurred_at,
        system: input.module === "guanyin" ? "sign" : input.module,
        payload: input.payload,
        source_refs: [],
        schema_version: "1.0",
      }),
    });
  } catch {
    return failure("session-event-v2", "PRIVATE_DATA_SERVICE_UNAVAILABLE", "历史记录服务暂不可用。", undefined, 503);
  }
  if (!response) return failure("session-event-v2", "UNAUTHORIZED", "请先登录后再保存记录。", undefined, 401);
  return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
}
