import type { GuanyinKnowledgeRetrievalResult } from "./knowledge-retrieval";
import type {
  GuanyinEvidenceIntegration,
  GuanyinIntegratedClaim,
  GuanyinIntegratedEvidenceReference,
  GuanyinReasoningStatement,
  GuanyinStick,
  GuanyinStructuredReasoning,
} from "./types";

export const guanyinEvidenceIntegrationVersion = "guanyin-evidence-integration-1.0.0" as const;

function unique(values: readonly string[]) {
  return Object.freeze([...new Set(values.filter((value) => value.trim().length > 0))]);
}

function integrateClaim(statement: GuanyinReasoningStatement | null): GuanyinIntegratedClaim | null {
  if (!statement) return null;
  return Object.freeze({ text: statement.text, tagIds: unique(statement.tagIds), sourceIds: unique(statement.sourceIds) });
}

function integrateClaims(statements: readonly GuanyinReasoningStatement[]) {
  return Object.freeze(statements.map((statement) => integrateClaim(statement)!));
}

function buildForbiddenClaims(reasoning: GuanyinStructuredReasoning) {
  const tagIds = new Set(reasoning.evidence.map((item) => item.tag.id));
  const forbidden = [
    "不得把传统文本倾向写成现实结果保证。",
    "不得把传统时间提示写成确定日期或期限。",
    "不得把其他签文或典籍资料表述为本次抽中的签文。",
    "不得把系统安全规则表述为观音灵签原意。",
    "不得虚构、替换或省略证据来源类型。",
    "证据不足时必须保留不确定性，不得自行补全因果关系。",
  ];
  if (tagIds.has("risk.hidden_harm")) forbidden.push("不得把象征性风险写成已经确认有人加害；只能建议核实、保护、存证和求助。");
  if (tagIds.has("theme.relationship_harmony") || reasoning.domain === "marriage") forbidden.push("不得把和合倾向写成对方已经同意、关系已经确定或双方必然结合。");
  if (reasoning.domain === "health" || reasoning.questionAnalysis.safetyFlags.includes("medical_decision")) forbidden.push("不得用签文或知识证据替代医疗诊断，也不得建议自行停止检查、用药或治疗。");
  if (reasoning.domain === "wealth") forbidden.push("不得把财富倾向写成投资、交易或收益保证。");
  if (reasoning.domain === "family" && tagIds.has("risk.household_instability")) forbidden.push("不得把‘家宅不安’等传统措辞写成已经发生或必将发生的现实灾害；应核实现实中的具体家庭、照护与安全问题。");
  if (reasoning.domain === "travel" && reasoning.questionAnalysis.primaryIntent === "relocation") forbidden.push("不得用‘守旧’覆盖安全、健康、照护、合同到期等现实紧迫搬迁原因；存在紧迫原因时应以现实需要为先。");
  if (reasoning.domain === "career" && reasoning.questionAnalysis.primaryIntent === "career_change") forbidden.push("不得因机会、贵人或转机倾向建议立即辞职；在关键条件未核实前，不得推动不可逆职业决定。");
  return unique(forbidden);
}

export function buildGuanyinEvidenceIntegration(input: {
  stick: GuanyinStick;
  reasoning: GuanyinStructuredReasoning;
  knowledge: GuanyinKnowledgeRetrievalResult;
}): GuanyinEvidenceIntegration {
  const { stick, reasoning, knowledge } = input;
  const mappingByTagId = new Map(knowledge.mappings.map((mapping) => [mapping.tagId, mapping]));
  const claimSourceIds = new Set([reasoning.coreJudgment, ...reasoning.actions, ...reasoning.trends, ...reasoning.risks]
    .filter((statement) => statement !== null)
    .flatMap((statement) => statement.sourceIds));
  const drawnEvidence: GuanyinIntegratedEvidenceReference[] = reasoning.evidence.map((item) => {
    const mapping = mappingByTagId.get(item.tag.id);
    return Object.freeze({
      sourceId: item.sourceId,
      type: "drawn_oracle" as const,
      recommendedUse: claimSourceIds.has(item.sourceId) ? "direct" as const : "context_only" as const,
      title: `第 ${stick.id} 签 · ${item.tag.label}`,
      text: item.evidenceText,
      url: null,
      boundary: claimSourceIds.has(item.sourceId)
        ? "该资料直接支持当前问题的结构化判断；仍须遵守现实边界与不确定性说明。"
        : "该资料属于本次抽中的签，但没有直接支持当前问题的核心判断、行动、趋势或风险，只能作为背景。",
      tagIds: Object.freeze([item.tag.id]),
      conceptIds: Object.freeze(mapping?.concept ? [mapping.concept.id] : []),
    });
  });
  const knowledgeEvidence: GuanyinIntegratedEvidenceReference[] = knowledge.evidence.map((item) => {
    const mappingBoundaries = item.tagIds.flatMap((tagId) => {
      const boundary = mappingByTagId.get(tagId)?.boundary;
      return boundary ? [boundary] : [];
    });
    return Object.freeze({
      sourceId: item.sourceId,
      type: item.sourceType === "system_safety" ? "system_safety" as const : "traditional_context" as const,
      recommendedUse: item.sourceType === "system_safety" ? "direct" as const : "context_only" as const,
      title: item.title,
      text: item.excerpt,
      url: item.url || null,
      boundary: item.boundary ?? (unique(mappingBoundaries).join("；") || "只能作为补充背景，不得覆盖结构化核心判断。"),
      tagIds: unique(item.tagIds),
      conceptIds: unique(item.conceptIds),
    });
  });
  const evidenceById = new Map<string, GuanyinIntegratedEvidenceReference>();
  for (const item of [...drawnEvidence, ...knowledgeEvidence]) if (!evidenceById.has(item.sourceId)) evidenceById.set(item.sourceId, item);
  const safetyGuidance = unique([
    ...(reasoning.primarySafetyAnswer ? [reasoning.primarySafetyAnswer.text] : []),
    ...reasoning.practicalGuidance.map((item) => item.text),
    ...knowledgeEvidence.filter((item) => item.type === "system_safety").map((item) => item.text),
  ]);
  const knowledgeUncertainties = [
    ...knowledge.unsupportedTagIds.map((tagId) => `标签 ${tagId} 尚无可审核的知识映射。`),
    ...knowledge.noEvidenceTagIds.map((tagId) => `标签 ${tagId} 在当前受控知识中没有可靠证据。`),
  ];

  return Object.freeze({
    version: guanyinEvidenceIntegrationVersion,
    status: reasoning.coverage === "reviewed" ? "ready" : "reasoning_unavailable",
    precedence: Object.freeze(["system_safety", "structured_reasoning", "drawn_oracle", "traditional_context"] as const),
    coreJudgment: integrateClaim(reasoning.coreJudgment),
    actions: integrateClaims(reasoning.actions),
    trends: integrateClaims(reasoning.trends),
    risks: integrateClaims(reasoning.risks),
    safetyGuidance,
    uncertainties: unique([...reasoning.uncertainties, ...knowledgeUncertainties]),
    evidence: Object.freeze([...evidenceById.values()]),
    forbiddenClaims: buildForbiddenClaims(reasoning),
  });
}
