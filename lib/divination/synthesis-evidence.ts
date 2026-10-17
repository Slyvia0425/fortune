import { InterpretationFailure } from "../server/interpretation-diagnostics";
import type { DivinationEvidencePack, HybridEvidenceUnit } from "../contracts/divination";

// Only exact identifiers are replaced; prose and source quotations are untouched.
export function mapEvidenceIds(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map(item => mapEvidenceIds(item, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapEvidenceIds(item, ids)]));
  return value;
}
export function synthesisAliases(pack: DivinationEvidencePack, evidence: HybridEvidenceUnit[]) {
  const forward = new Map<string, string>();
  pack.evidence.forEach((item, index) => forward.set(item.evidence_id, `T${index + 1}`));
  for (const kind of ["rule", "case", "passage"] as const) evidence.filter(item => item.kind === kind).forEach((item, index) => forward.set(item.entity_revision_id, `${kind === "rule" ? "R" : kind === "case" ? "C" : "P"}${index + 1}`));
  return { forward, reverse: new Map([...forward].map(([id, alias]) => [alias, id])) };
}

export function validateSynthesisReview(value: unknown, ruleIds: string[], caseIds: string[]) {
  const fail = (reason = "审核记录结构不完整。") => { throw new InterpretationFailure("coverage", "SYNTHESIS_REVIEW_COVERAGE_INVALID", [reason]); };
  if (!value || typeof value !== "object") return fail();
  const output = value as Record<string, unknown>;
  const nonempty = (v: unknown) => typeof v === "string" && !!v.trim();
  const review = (key: string, ids: string[], details: string[]) => {
    const rows = output[key];
    if (!Array.isArray(rows) || rows.length !== ids.length) return fail(`${key} 应覆盖 ${ids.length} 条材料，实际为 ${Array.isArray(rows) ? rows.length : "非数组"}；要求 ID：${ids.join(", ")}`);
    const found = new Set<string>();
    for (const row of rows) {
      if (!row || !ids.includes(row.evidence_id) || found.has(row.evidence_id) || !["applicable", "excluded", "uncertain"].includes(row.status) || details.some(field => !nonempty(row[field]))) return fail(`${key} 存在未知／重复 ID、非法状态或空字段：${JSON.stringify(row)}`);
      found.add(row.evidence_id);
    }
    return rows;
  };
  const rules = review("rule_applicability", ruleIds, ["original_scope", "question_match", "reason"]);
  const cases = review("case_comparisons", caseIds, ["similarities", "differences", "lesson"]);
  // Every applicable case must contribute an explicit, cited comparison to the explanation.
  if (!Array.isArray(output.contextual_reflections)) return fail();
  const reflections = output.contextual_reflections as Array<{text?: string; evidence_ids?: string[]}>;
  for (const row of [...rules, ...cases]) {
    const cited = reflections.some(item => item.evidence_ids?.includes(row.evidence_id));
    if ((row.status === "excluded" && cited) || (caseIds.includes(row.evidence_id) && row.status === "applicable" && !cited)) return fail(`材料 ${row.evidence_id} 状态 ${row.status} 与实际引用 ${cited} 不一致。`);
  }
}
