import { RecordedInterpretationFailure, stageNames, type InterpretationDiagnostic } from "@/lib/server/interpretation-diagnostics";
import type { DivinationCastResult, HybridEvidencePack, HybridInterpretation, QuestionContext } from "@/lib/contracts/divination";
import { failure, record, success, text } from "@/lib/contracts/api";
import { buildDivinationEvidencePack } from "@/lib/divination/evidence";
import { divinationLlmConfigured, interpretDivinationEvidence, interpretHybridEvidence } from "@/lib/server/divination-llm";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { cookies } from "next/headers";
import { cachedInterpretation } from "@/lib/server/interpretation-cache";
import { AUTH_COOKIE } from "@/lib/server/module4-auth";
import { DIVINATION_SESSION_COOKIE } from "@/lib/server/liuyao-hybrid";

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const cookieStore = await cookies();
  const owner = cookieStore.get(AUTH_COOKIE)?.value ?? cookieStore.get(DIVINATION_SESSION_COOKIE)?.value;
  if (!owner) return failure("divination-interpret-v2", "SESSION_REQUIRED", "当前会话无法读取原卦盘，请确认使用原起卦会话。", undefined, 401);
  const { retry, ...body } = record(input) ?? {};
  return cachedInterpretation(owner, { pipeline_version: "integrated-v6-source-only", request: body }, retry === true, () => generate(new Request(request.url, { method: "POST", body: JSON.stringify(body) })));
}

async function generate(request: Request) {
  let body: Record<string, unknown> | null = null;
  try { body = record(await request.json()); } catch {}
  const chartId = text(body?.chart_id, 36);
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chartId)
    || Object.keys(body).some(key => !["chart_id", "chart_hash", "question_context"].includes(key))) {
    return failure("divination-interpret-v2", "VALIDATION_ERROR", "解释必须引用服务端冻结卦盘，不接受客户端盘面或改写问题。", undefined, 422);
  }
  try {
    const questionContext = body.question_context && typeof body.question_context === "object" ? body.question_context as QuestionContext : undefined;
    const saved = await callHybrid<{cast: DivinationCastResult; question: string; hybrid_evidence: HybridEvidencePack}>("evidence", { chart_id: chartId, question_context: questionContext });
    if (body.chart_hash && body.chart_hash !== saved.cast.chart_hash) {
      return failure("divination-interpret-v2", "CHART_MISMATCH", "卦盘版本不一致，请重新读取原起卦记录。", undefined, 409);
    }
    const evidencePack = buildDivinationEvidencePack({ question: saved.question, cast: saved.cast });
    const warnings: string[] = [];
    // Candidate analysis must finish before synthesis; rejected raw attempts never enter synthesis.
    let hybrid: HybridInterpretation;
    try { hybrid = await interpretHybridEvidence(saved.hybrid_evidence, saved.cast.core_facts, saved.question); }
    catch { hybrid = { status: "unavailable", readings: [], validation: "not_generated", message: "候选分析暂不可用。" }; }
    let interpretationDiagnostic: InterpretationDiagnostic | undefined;
    let classical: Awaited<ReturnType<typeof interpretDivinationEvidence>> | null = null;
    if (!divinationLlmConfigured()) warnings.push("综合解释服务未配置。");
    else {
      try { classical = await interpretDivinationEvidence(evidencePack, {
        core: saved.cast.core_facts, evidence: saved.hybrid_evidence, candidateAnalysis: hybrid,
      }); }
      catch (error) {
        if (error instanceof RecordedInterpretationFailure) {
          interpretationDiagnostic = error.diagnostic;
          warnings.push(`${stageNames[error.diagnostic.stage]}未通过（${error.diagnostic.code}）。${error.diagnostic.reasons.map(reason => {try { return JSON.parse(reason).description ?? reason; } catch { return reason; }}).slice(0,3).join("；")} 诊断编号：${error.diagnostic.run_id}`);
        } else {
        const code = error instanceof Error ? error.message : "";
        warnings.push(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? "综合解释请求超时，已保留原卦盘，可重试。"
          : code === "LLM_INVALID_INTERPRETATION" ? "综合解释未通过格式或引用完整性校验。"
          : "综合解释暂不可用，已保留原卦盘，可重试。");
        }
      }
    }
    return Response.json(success({ evidence_pack: evidencePack, modern_interpretation: classical?.interpretation ?? null,
      interpretation_diagnostic: interpretationDiagnostic, diagnostic_run_id: interpretationDiagnostic?.run_id ?? classical?.diagnostic_run_id,
      model_used: classical?.model, hybrid_evidence: saved.hybrid_evidence, hybrid_interpretation: hybrid,
      frozen_core: saved.cast.core_facts }, { system: "divination-interpret-v2", sources: evidencePack.sources, warnings }));
  } catch (error) {
    return failure("divination-interpret-v2", "INTERPRETATION_SERVICE_ERROR",
      error instanceof HybridServiceError ? error.message : "解释依据暂不可用，系统未重新起卦。",
      undefined, error instanceof HybridServiceError ? error.status : 502);
  }
}
