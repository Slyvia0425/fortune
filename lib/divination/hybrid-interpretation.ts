import type { HybridEvidencePack, HybridReading } from "../contracts/divination";

// Validate the entire response; never silently remove fabricated citations and keep the prose.
export function parseHybridReadings(content: string, pack: HybridEvidencePack): HybridReading[] {
  const value = JSON.parse(content);
  if (pack.status !== "evidence_ready" || !pack.interpretation_contract.strong_conclusion_allowed
    || value.chart_hash !== pack.chart_hash || value.method_profile_id !== pack.method_profile_id
    || !Array.isArray(value.readings) || !value.readings.length || value.readings.length > 8) {
    throw new Error("HYBRID_INTERPRETATION_INVALID");
  }
  const allowed = new Set(pack.supporting_evidence.filter(u => !u.not_for_interpretation
    && u.condition_evaluation === "true" && !u.conflict_group_ids.length).map(u => u.entity_revision_id));
  return value.readings.map((reading: unknown) => {
    if (!reading || typeof reading !== "object") throw new Error("HYBRID_INTERPRETATION_INVALID");
    const r = reading as Record<string, unknown>;
    if (typeof r.text !== "string" || !r.text.trim() || r.text.length > 1200
      || !Array.isArray(r.evidence_ids) || !r.evidence_ids.length
      || r.evidence_ids.some(id => typeof id !== "string" || !allowed.has(id))) {
      throw new Error("HYBRID_CITATION_INVALID");
    }
    return { text: r.text.trim(), evidence_ids: [...new Set(r.evidence_ids)] as string[] };
  });
}
