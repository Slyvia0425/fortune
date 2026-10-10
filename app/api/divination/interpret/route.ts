import type { DivinationCastResult, HybridEvidencePack, HybridInterpretation } from "@/lib/contracts/divination";
import { failure, record, success, text } from "@/lib/contracts/api";
import { buildDivinationEvidencePack } from "@/lib/divination/evidence";
import { divinationLlmConfigured, interpretDivinationEvidence, interpretHybridEvidence } from "@/lib/server/divination-llm";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try { body = record(await request.json()); } catch {}
  const chartId = text(body?.chart_id, 36);
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chartId)
    || Object.keys(body).some(key => !["chart_id", "chart_hash"].includes(key))) {
    return failure("divination-interpret-v2", "VALIDATION_ERROR", "解释必须引用服务端冻结卦盘，不接受客户端盘面或改写问题。", undefined, 422);
  }
  try {
    const saved = await callHybrid<{cast: DivinationCastResult; question: string; hybrid_evidence: HybridEvidencePack}>("evidence", { chart_id: chartId });
    if (body.chart_hash && body.chart_hash !== saved.cast.chart_hash) {
      return failure("divination-interpret-v2", "CHART_MISMATCH", "卦盘版本不一致，请重新读取原起卦记录。", undefined, 409);
    }
    const evidencePack = buildDivinationEvidencePack({ question: saved.question, cast: saved.cast });
    const warnings: string[] = [];
    const [classical, hybrid] = await Promise.all([
      (async () => {
        if (!divinationLlmConfigured()) { warnings.push("文本转述服务未配置，保留典籍原文。"); return null; }
        try { return await interpretDivinationEvidence(evidencePack); }
        catch { warnings.push("文本转述暂不可用，保留典籍原文。"); return null; }
      })(),
      (async (): Promise<HybridInterpretation> => {
        try { return await interpretHybridEvidence(saved.hybrid_evidence, saved.cast.core_facts, saved.question); }
        catch { return { status: "unavailable", readings: [], validation: "not_generated", message: "规则解释未通过检查或服务暂不可用，已保留可核验依据。" }; }
      })(),
    ]);
    return Response.json(success({ evidence_pack: evidencePack, modern_interpretation: classical?.interpretation ?? null,
      model_used: classical?.model, hybrid_evidence: saved.hybrid_evidence, hybrid_interpretation: hybrid,
      frozen_core: saved.cast.core_facts }, { system: "divination-interpret-v2", sources: evidencePack.sources, warnings }));
  } catch (error) {
    return failure("divination-interpret-v2", "INTERPRETATION_SERVICE_ERROR",
      error instanceof HybridServiceError ? error.message : "解释依据暂不可用，系统未重新起卦。",
      undefined, error instanceof HybridServiceError ? error.status : 502);
  }
}
