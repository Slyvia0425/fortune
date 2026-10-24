import { randomInt } from "node:crypto";

import { failure, record, success, text } from "../../../../lib/contracts/api";
import { buildGuanyinEvidenceIntegration } from "../../../../lib/guanyin/evidence-integration";
import { buildGuanyinLlmGenerationRequest } from "../../../../lib/guanyin/llm-explanation";
import { getGuanyinStick } from "../../../../lib/guanyin/library";
import { retrieveKnowledgeForGuanyinReasoning } from "../../../../lib/guanyin/knowledge-retrieval";
import { buildGuanyinStructuredReasoning } from "../../../../lib/guanyin/reasoning";
import { isQuestionDomain, type GuanyinDrawResult } from "../../../../lib/guanyin/types";

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    body = record(await request.json());
  } catch {}

  const question = text(body?.question);
  const domain = body?.domain;
  const locale = body?.locale === "en" ? "en" : "zh";
  if (!isQuestionDomain(domain)) {
    return failure("guanyin-100-v1", "INVALID_DOMAIN", "请选择有效的问题领域。", undefined, 400);
  }

  const stick = getGuanyinStick(randomInt(1, 101));
  const reasoning = buildGuanyinStructuredReasoning({ signId: stick.id, domain, question });
  const knowledge = retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 });
  const evidenceIntegration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge });
  const generationRequest = buildGuanyinLlmGenerationRequest({ question, domain, integration: evidenceIntegration, locale });
  const llmGeneration: GuanyinDrawResult["llm_generation"] = evidenceIntegration.status === "ready"
    ? { status: "pending", request: generationRequest, explanation: null, model: null, warning: null }
    : { status: "integration_unavailable", request: generationRequest, explanation: null, model: null, warning: "结构化推理尚未完成，系统未调用扩展解释。" };
  const result: GuanyinDrawResult = {
    stick,
    question,
    domain,
    drawn_at: new Date().toISOString(),
    reasoning,
    evidence_integration: evidenceIntegration,
    llm_generation: llmGeneration,
  };

  return Response.json(success(result, {
    system: "guanyin-100-v1",
    sessionId: crypto.randomUUID(),
    sources: [{ source_id: "guanyin-100", title: "观音灵签百签结构化签库" }],
    warnings: [
      ...(!question ? ["未提供问题，返回通用签文。"] : []),
      ...(result.reasoning.coverage === "unavailable" ? ["该签尚未进入已复核语义样本，仅展示传统原文。"] : []),
      ...knowledge.warnings,
      ...(llmGeneration.warning ? [llmGeneration.warning] : []),
    ],
  }));
}
