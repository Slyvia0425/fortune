import { failure, record, success, text } from "../../../../lib/contracts/api";
import { buildGuanyinEvidenceIntegration } from "../../../../lib/guanyin/evidence-integration";
import { buildGuanyinLlmGenerationRequest } from "../../../../lib/guanyin/llm-explanation";
import { getGuanyinStick } from "../../../../lib/guanyin/library";
import { retrieveKnowledgeForGuanyinReasoning } from "../../../../lib/guanyin/knowledge-retrieval";
import { buildGuanyinStructuredReasoning } from "../../../../lib/guanyin/reasoning";
import { isQuestionDomain, type GuanyinLlmGeneration } from "../../../../lib/guanyin/types";
import { generateGuanyinExplanation, guanyinLlmConfigured } from "../../../../lib/server/guanyin-llm";

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try { body = record(await request.json()); } catch {}
  const question = text(body?.question);
  const domain = body?.domain;
  const signId = Number(body?.signId);
  if (!isQuestionDomain(domain)) return failure("guanyin-100-v1", "INVALID_DOMAIN", "请选择有效的问题领域。", undefined, 400);
  if (!Number.isInteger(signId) || signId < 1 || signId > 100) return failure("guanyin-100-v1", "INVALID_SIGN", "签号无效。", undefined, 400);

  const stick = getGuanyinStick(signId);
  const reasoning = buildGuanyinStructuredReasoning({ signId, domain, question });
  const knowledge = retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 });
  const integration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge });
  const generationRequest = buildGuanyinLlmGenerationRequest({ question, domain, integration });
  let result: GuanyinLlmGeneration;
  if (integration.status !== "ready") result = { status: "integration_unavailable", request: generationRequest, explanation: null, model: null, warning: "当前签文尚未完成结构化复核，暂不生成扩展解释。" };
  else if (!guanyinLlmConfigured()) result = { status: "not_configured", request: generationRequest, explanation: null, model: null, warning: "现代解释服务暂不可用，已保留基础解读。" };
  else {
    try {
      const generated = await generateGuanyinExplanation({ question, domain, integration });
      result = { status: "generated", request: generationRequest, explanation: generated.explanation, model: generated.model, warning: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      result = message === "LLM_INSUFFICIENT_EXPLANATION"
        ? { status: "insufficient_evidence", request: generationRequest, explanation: null, model: null, warning: "当前证据不足，暂不生成扩展解释。" }
        : { status: "failed", request: generationRequest, explanation: null, model: null, warning: "现代解释暂未生成，基础解读仍然有效。" };
    }
  }
  return Response.json(success(result, { system: "guanyin-100-v1", warnings: result.warning ? [result.warning] : [] }));
}
