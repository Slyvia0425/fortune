export type CastingMethod="numbers"|"random"|"coins";
export interface DivinationCastRequest { question:string; method:CastingMethod; numbers?:number[]; coins?:number[][]; time_range?:string }
export interface HexagramView { number:number; name:string; upper_trigram:string; lower_trigram:string; lines:Array<6|7|8|9> }
export interface DivinationCastResult { primary:HexagramView; moving_lines:number[]; mutual:HexagramView; transformed:HexagramView; traditional_meaning:string; contextual_interpretation:string }
export type DivinationEvidenceRole="primary_judgment"|"primary_moving_line"|"transformed_judgment"|"transformed_static_line"|"special_line";
export interface DivinationEvidenceItem { evidence_id:string; role:DivinationEvidenceRole; hexagram_number:number; hexagram_name:string; line_position?:number; priority:number; original:string; commentary:string[]; translation_en?:string; source_ids:string[] }
export interface DivinationEvidencePack { rule_version:"changing-lines-v1"; selection_rule:string; question:string; time_range?:string; primary:{number:number;name:string}; transformed:{number:number;name:string}; moving_lines:number[]; evidence:DivinationEvidenceItem[]; sources:import("./api").SourceReference[] }
export interface DivinationInterpretationReading { evidence_id:string; modern_chinese:string }
export interface DivinationContextualReflection { text:string; evidence_ids:string[] }
export interface DivinationModernInterpretation { readings:DivinationInterpretationReading[]; contextual_reflections:DivinationContextualReflection[]; uncertainties:string[]; disclaimer:string }
export interface DivinationInterpretationResult { evidence_pack:DivinationEvidencePack; modern_interpretation:DivinationModernInterpretation|null; model_used?:string }
export type ChatRole="user"|"assistant";
export interface DivinationChatMessage { role:ChatRole; content:string }
export interface DivinationChatRequest { messages:DivinationChatMessage[] }
export interface DivinationExtraction { source:"llm"|"rules"; question?:string; time_range?:string; method?:CastingMethod; numbers?:number[]; fallback_reason?:string }
export interface DivinationChatReply { status:"clarify"|"ready"; message:string; suggestions:string[]; cast_request?:DivinationCastRequest; extraction?:DivinationExtraction }
