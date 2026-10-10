import type { DivinationCastResult, HexagramView } from "@/lib/contracts/divination";
import { failure, record, success, text } from "@/lib/contracts/api";
import { buildDivinationEvidencePack } from "@/lib/divination/evidence";
import { divinationLlmConfigured, interpretDivinationEvidence } from "@/lib/server/divination-llm";

function hexagram(value: unknown): value is HexagramView {
  const item = record(value);
  return Boolean(
    item
    && Number.isInteger(item.number)
    && typeof item.name === "string"
    && typeof item.upper_trigram === "string"
    && typeof item.lower_trigram === "string"
    && Array.isArray(item.lines)
    && item.lines.length === 6
    && item.lines.every((line) => line === 6 || line === 7 || line === 8 || line === 9),
  );
}

function castResult(value: unknown): value is DivinationCastResult {
  const item = record(value);
  return Boolean(
    item
    && hexagram(item.primary)
    && hexagram(item.mutual)
    && hexagram(item.transformed)
    && Array.isArray(item.moving_lines)
    && item.moving_lines.every((line) => Number.isInteger(line) && Number(line) >= 1 && Number(line) <= 6),
  );
}

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try { body = record(await request.json()); } catch {}
  const question = text(body?.question, 500);
  if (!body || !question || !castResult(body.cast_result)) {
    return failure("divination-interpret-v1", "VALIDATION_ERROR", "请提供 question 和有效的 cast_result。");
  }
  try {
    const evidencePack = buildDivinationEvidencePack({
      question,
      time_range: text(body.time_range, 80) || undefined,
      cast: body.cast_result,
    });
    if (!divinationLlmConfigured()) {
      return Response.json(success(
        { evidence_pack: evidencePack, modern_interpretation: null },
        {
          system: "divination-interpret-v1",
          sources: evidencePack.sources,
          warnings: ["LLM 尚未配置；已保留可核验的原文、注释、译文和来源。"],
        },
      ));
    }
    try {
      const generated = await interpretDivinationEvidence(evidencePack);
      return Response.json(success(
        { evidence_pack: evidencePack, modern_interpretation: generated.interpretation, model_used: generated.model },
        { system: "divination-interpret-v1", sources: evidencePack.sources },
      ));
    } catch (error) {
      return Response.json(success(
        { evidence_pack: evidencePack, modern_interpretation: null },
        {
          system: "divination-interpret-v1",
          sources: evidencePack.sources,
          warnings: [`LLM 转述不可用；已保留本地典籍证据。（${error instanceof Error ? error.message : "unknown"}）`],
        },
      ));
    }
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    const evidenceFailure = cause === "HEXAGRAM_EVIDENCE_INCOMPLETE" || cause === "SELECTED_EVIDENCE_MISSING";
    return failure(
      "divination-interpret-v1",
      evidenceFailure ? "EVIDENCE_NOT_AVAILABLE" : "INTERPRETATION_SERVICE_ERROR",
      evidenceFailure ? "本地知识库缺少本次解释所需证据，系统不会生成替代内容。" : "现代中文解释暂时不可用。",
      { cause },
      evidenceFailure ? 422 : 502,
    );
  }
}
