import type { LiuyaoCoreFacts, UseRoleAnalysis } from "../contracts/divination";
import type { SingleQuestionAnalysis } from "./question-analysis";
import { validateUseRoles } from "./fixed-use-rules";
import { validateRelationCore } from "./fact-relations";

export const USE_ROLE_RULE_VERSION = "reviewed-career-self-pr65-v1";

/** Only an explicit, validated querent subject enables a reviewed self profile. */
export function resolveReviewedUseRoles(
  core: LiuyaoCoreFacts, chartHash: string, question: SingleQuestionAnalysis,
): {status: "resolved" | "unsupported" | "ambiguous"; analysis: UseRoleAnalysis | null} {
  const actor = question.actors.find(a => a.id === question.subject_actor_id);
  if (question.status !== "valid" || question.domain !== "career"
    || !["new_job", "promotion"].includes(question.event_type) || actor?.role !== "querent") {
    return {status: "unsupported", analysis: null};
  }
  validateRelationCore(core);
  const analysis = validateUseRoles(JSON.stringify({
    primary: {role: "officials", rule_id: "career", meaning: "职位", reason: "已确认本人求职或晋升，采用已审定的官鬼与世爻规则。"},
    auxiliary: [{role: "self", rule_id: "career", meaning: "本人", reason: "世爻观察求测者本人。"}],
    missing_information: [], uncertainties: [],
  }), core, chartHash);
  analysis.rules_version = USE_ROLE_RULE_VERSION;
  const primary = analysis.primary!;
  // Preserve every candidate; hidden usability is intentionally unresolved.
  const resolved = primary.main_line_refs.length === 1 && primary.location_status === "main";
  if (!resolved) analysis.status = "insufficient";
  return {status: resolved ? "resolved" : "ambiguous", analysis};
}
