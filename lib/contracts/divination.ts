export type CastingMethod="three_numbers";
export type NumberTriple=[number,number,number];
export interface CoreCastReceipt { request_id:string; cast_id:string; raw_numbers:NumberTriple; validated_numbers:NumberTriple; raw_question:string; submitted_at:string; cast_at:string; timezone:string; timezone_source:"client"|"server_default"; casting_algorithm_id:string; casting_algorithm_version:string; calendar_policy_id:string; core_version:string; method_profile_id:string; method_profile_version:string; question_parser_version:string }
export interface DivinationCastRequest { question:string; method:CastingMethod; numbers:NumberTriple; timezone?:string; request_id?:string; conversation_id?:string }
export interface HexagramView { number:number; name:string; upper_trigram:string; lower_trigram:string; lines:Array<6|7|8|9> }
export interface LiuyaoLineFact {
  ref:string; position:number; yin_yang_value:6|7|8|9; yin_yang:"yin"|"yang";
  age:"old"|"young"; moving:boolean; stem:string; branch:string; ganzhi:string; element:string;
  kin:"parents"|"siblings"|"offspring"|"wealth"|"officials"; kin_name:string;
  kin_basis:"primary_palace"; position_role:"self"|"response"|null; six_spirit:string;
  strength:{policy_id:string; month_seasonal_label:string; month_break:boolean; day_clash:boolean;
    xun_empty:boolean; month_life_stage:string; day_life_stage:string; overall_strength:null;
    overall_strength_status:string; month_relation:Record<string,string|boolean>; day_relation:Record<string,string|boolean>};
  flying_line_ref?:string; usable?:null; usability_status?:string;
}
export interface LiuyaoCoreFacts {
  core_version:string; calendar:{policy_id:string; calendar_timezone:string; display_timezone:string;
    day_ganzhi:string; month_ganzhi:string; empty_branches:string[]; [key:string]:unknown};
  palace:{trigram:string;element:string;stage:string;self_position:number;response_position:number};
  main_lines:LiuyaoLineFact[]; main_lines_complete:boolean;
  transformed_lines:LiuyaoLineFact[]; transformed_lines_complete:boolean;
  hidden_lines:LiuyaoLineFact[]; hidden_lines_complete:boolean;
  capability_gaps:string[]; interpretation_limits:string[];
}
export interface DivinationCastResult { chart_id?:string; chart_hash?:string; core_facts?:LiuyaoCoreFacts; opposite?:HexagramView; reversed?:HexagramView; primary:HexagramView; moving_lines:number[]; mutual:HexagramView; transformed:HexagramView; traditional_meaning:string; contextual_interpretation:string; core_receipt?:CoreCastReceipt }
export type FieldProvenance="user_explicit"|"conversation_explicit"|"model_inference"|"unknown";
export interface QuestionFieldEvidence { message_id?:string;text:string;start_offset:number;end_offset_exclusive:number }
export interface QuestionField<T> { value:T|null; provenance:FieldProvenance; evidence?:QuestionFieldEvidence; verification_status:"confirmed"|"extracted"|"unknown" }
export interface QuestionContext { raw_question:string; initiator:QuestionField<string>; number_provider:QuestionField<string>; perspective_person:QuestionField<string>; goal:QuestionField<string>; question_kind:QuestionField<"feasibility"|"timing"|"status"|"choice"|"reason">; ambiguities:string[]; goal_groups:string[] }
export interface AnalysisPlan { goal_id:string|null; candidate_ids:string[]; required_rule_types:string[]; required_fact_ids:string[]; missing_fact_ids:string[]; allowed_topics:string[]; forbidden_expansions:string[]; timing_requested:boolean; precision_limit:"full"|"conditional"|"insufficient"; status:"ready_for_reviewed_rules"|"blocked_pending_rules"|"needs_clarification" }
export type DivinationEvidenceRole="primary_judgment"|"primary_moving_line"|"transformed_judgment"|"transformed_static_line"|"special_line";
export interface DivinationEvidenceItem { evidence_id:string; role:DivinationEvidenceRole; hexagram_number:number; hexagram_name:string; line_position?:number; priority:number; original:string; commentary:string[]; translation_en?:string; source_ids:string[] }
export interface DivinationEvidencePack { rule_version:"changing-lines-v1"; selection_rule:string; question:string; time_range?:string; primary:{number:number;name:string;upper_trigram:string;lower_trigram:string;five_element_relation:string}; transformed:{number:number;name:string;upper_trigram:string;lower_trigram:string}; moving_lines:number[]; evidence:DivinationEvidenceItem[]; sources:import("./api").SourceReference[] }
export interface DivinationInterpretationReading { evidence_id:string; modern_chinese:string }
export interface DivinationContextualReflection { text:string; evidence_ids:string[] }
export interface DivinationModernInterpretation { overall_interpretation:string; readings:DivinationInterpretationReading[]; contextual_reflections:DivinationContextualReflection[]; uncertainties:string[]; disclaimer:string }
export interface DivinationInterpretationResult { frozen_core?:LiuyaoCoreFacts; hybrid_evidence?:HybridEvidencePack; hybrid_interpretation?:HybridInterpretation; evidence_pack:DivinationEvidencePack; modern_interpretation:DivinationModernInterpretation|null; model_used?:string }
export type ChatRole="user"|"assistant";
export interface DivinationChatMessage { role:ChatRole; content:string }
export interface DivinationChatRequest { messages:DivinationChatMessage[] }
export interface DivinationExtraction { source:"llm"|"rules"; question?:string; time_range?:string; method?:CastingMethod; numbers?:NumberTriple; fallback_reason?:string }
export interface DivinationChatReply { status:"clarify"|"ready"; message:string; suggestions:string[]; cast_request?:DivinationCastRequest; extraction?:DivinationExtraction }

export interface HybridEvidenceUnit {
  entity_revision_id:string; entity_id:string; kind:"rule"|"case"; summary:string;
  not_for_interpretation:boolean; condition_evaluation:"true"|"false"|"unknown";
  conflict_group_ids:string[];
  source_quotes:Array<{source_revision_id:string; quote:string; quote_hash:string; start:number; end:number; url?:string}>;
}
export interface HybridEvidencePack {
  chart_id:string; chart_hash:string; method_profile_id:string; core_version:string;
  knowledge_release_id:string; retrieval_run_id:string; status:"evidence_ready"|"evidence_insufficient";
  supporting_evidence:HybridEvidenceUnit[]; pending_conditions:HybridEvidenceUnit[]; counter_evidence:HybridEvidenceUnit[];
  gaps:string[]; clarification:Array<{field:string; question:string}>;
  selected_use:Array<{role_id:string; line_ref:string; rule_ids:string[]}>;
  candidate_roles:Array<{role_id:string; presence_status:string; main_hexagram_line_refs:string[]; hidden_line_refs:string[]; selected_line_ref:string|null}>;
  interpretation_contract:{strong_conclusion_allowed:boolean; recast_allowed:boolean; copy_case_outcome:boolean};
}
export interface HybridReading { text:string; evidence_ids:string[] }
export interface HybridInterpretation {
  status:"generated"|"insufficient"|"unavailable"; readings:HybridReading[]; message:string;
  validation:"references_and_frozen_context"|"not_generated";
}
