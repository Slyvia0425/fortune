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
export interface QuestionEntity { entity_id:string; label:string; kind:"person"|"object"|"event"; provenance:FieldProvenance; evidence?:QuestionFieldEvidence }
export interface QuestionRelationship { from_entity_id:string; to_entity_id:string; relation:string; provenance:FieldProvenance; evidence?:QuestionFieldEvidence }
export interface QuestionContext {
  raw_question:string;
  initiator:QuestionField<string>; number_provider:QuestionField<string>; perspective_person:QuestionField<string>;
  target_entities:QuestionEntity[]; relationships:QuestionRelationship[]; topic_candidates:string[];
  goal:QuestionField<string>; question_kind:QuestionField<"feasibility"|"timing"|"status"|"choice"|"reason">;
  process_stage:QuestionField<string>; time_expression:QuestionField<string>; known_facts:QuestionField<string>[];
  assumptions:string[]; exclusions:string[]; ambiguities:string[]; goal_groups:string[];
  parser_status:"parsed"|"unavailable"|"invalid";
}
export interface AnalysisPlan { goal_id:string|null; candidate_ids:string[]; required_rule_types:string[]; required_fact_ids:string[]; missing_fact_ids:string[]; allowed_topics:string[]; forbidden_expansions:string[]; timing_requested:boolean; precision_limit:"full"|"conditional"|"insufficient"; status:"ready_for_reviewed_rules"|"blocked_pending_rules"|"needs_clarification" }
export type DivinationEvidenceRole="primary_judgment"|"primary_moving_line"|"transformed_judgment"|"transformed_static_line"|"special_line";
export interface DivinationEvidenceItem { evidence_id:string; role:DivinationEvidenceRole; hexagram_number:number; hexagram_name:string; line_position?:number; priority:number; original:string; commentary:string[]; translation_en?:string; source_ids:string[] }
export interface DivinationEvidencePack { rule_version:"changing-lines-v1"; selection_rule:string; question:string; time_range?:string; primary:{number:number;name:string;upper_trigram:string;lower_trigram:string;five_element_relation:string}; transformed:{number:number;name:string;upper_trigram:string;lower_trigram:string}; moving_lines:number[]; evidence:DivinationEvidenceItem[]; sources:import("./api").SourceReference[] }
export interface DivinationInterpretationReading { evidence_id:string; modern_chinese:string }
export interface DivinationContextualReflection { text:string; evidence_ids:string[] }
export interface DivinationModernInterpretation { overall_interpretation:string; readings:DivinationInterpretationReading[]; contextual_reflections:DivinationContextualReflection[]; uncertainties:string[]; disclaimer:string }
export interface DivinationInterpretationResult { diagnostic_run_id?:string; interpretation_diagnostic?:{run_id:string;stage:string;code:string;reasons:string[];log_saved:boolean}; frozen_core?:LiuyaoCoreFacts; hybrid_evidence?:HybridEvidencePack; hybrid_interpretation?:HybridInterpretation; evidence_pack:DivinationEvidencePack; modern_interpretation:DivinationModernInterpretation|null; model_used?:string }
export type ChatRole="user"|"assistant";
export interface DivinationChatMessage { role:ChatRole; content:string }
export interface DivinationChatRequest { messages:DivinationChatMessage[] }
export interface DivinationExtraction { source:"llm"|"rules"|"unavailable"; question?:string; time_range?:string; method?:CastingMethod; numbers?:NumberTriple; fallback_reason?:string }
export interface DivinationChatReply { status:"clarify"|"ready"; message:string; suggestions:string[]; cast_request?:DivinationCastRequest; extraction?:DivinationExtraction; question_context?:QuestionContext }

export interface HybridEvidenceUnit {
  usage?:"analogy_only"|"rule_reasoning";
  case_context?:{remaining_issues?:string[];question_status?:string;chart_status?:string;judgment_status?:string;outcome_status?:string;method_profile_id?:string|null;final_case_id?:string;case_group_id?:string;reading_id?:string}|null;
  entity_revision_id:string; entity_id:string; kind:"rule"|"case"; summary:string;
  not_for_interpretation:boolean; condition_evaluation:"true"|"false"|"unknown";
  conflict_group_ids:string[];
  source_quotes:Array<{source_revision_id:string; quote:string; quote_hash:string; start:number; end:number; url?:string}>;
}
export interface HybridEvidencePack {
  chart_id:string; chart_hash:string; method_profile_id:string; core_version:string;
  knowledge_release_id:string; retrieval_run_id:string; status:"evidence_ready"|"evidence_insufficient";
  facts?:{question?:unknown};
  reasoning_mode?:"llm_source_reasoning"; reasoning_evidence?:HybridEvidenceUnit[];
  supporting_evidence:HybridEvidenceUnit[]; pending_conditions:HybridEvidenceUnit[]; counter_evidence:HybridEvidenceUnit[];
  gaps:string[]; clarification:Array<{field:string; question:string}>;
  selected_use:Array<{role_id:string; line_ref:string; rule_ids:string[]}>;
  candidate_roles:Array<{role_id:string; presence_status:string; main_hexagram_line_refs:string[]; hidden_line_refs:string[]; selected_line_ref:string|null}>;
  interpretation_contract:{model_reasoning_allowed?:boolean; model_selection_allowed?:boolean; strong_conclusion_allowed:boolean; recast_allowed:boolean; copy_case_outcome:boolean};
}
export interface HybridReading { text:string; evidence_ids:string[] }
export interface HybridInterpretation {
  status:"generated"|"insufficient"|"unavailable"; readings:HybridReading[]; message:string;
  analysis?:ModelUseAnalysis;
  validation:"references_and_frozen_context"|"references_and_core_facts"|"not_generated";
  attempts?:ModelAnalysisAttempt[];
  validation_errors?:ModelAnalysisIssue[];
}
export interface ModelAnalysisIssue { code:string; path:string; message:string }
export interface ModelAnalysisAttempt { attempt:1|2; status:"accepted"|"rejected"|"request_error"; raw_output:string|null; errors:ModelAnalysisIssue[] }

export interface ModelUseCandidate {
  origin:"main"|"hidden"|"moving_transformation";
  candidate_id:string; role:"parents"|"siblings"|"offspring"|"wealth"|"officials"|"self"|"response";
  line_refs:string[]; evidence_ids:string[]; reason:string;
  known_facts:Array<{fact_ref:string;value:string|number|boolean|null}>;
  conditions:Array<{condition:string; status:"met"|"not_met"|"unknown"; fact_refs:string[]; evidence_ids:string[]}>;
  missing_conditions:string[]; exceptions:string[];
}
export interface ModelUseAnalysis {
  question_understanding:{subject:string;relation:string;goal:string;missing_information:string[]};
  candidates:ModelUseCandidate[];
  selection:{candidate_id:string|null;line_ref:string|null;evidence_ids:string[];reason:string};
  uncertainties:string[];
}
