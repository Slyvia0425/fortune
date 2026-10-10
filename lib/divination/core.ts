import type { AnalysisPlan, CoreCastReceipt, DivinationCastRequest, NumberTriple, QuestionContext, QuestionField } from "@/lib/contracts/divination";

export const CORE_VERSION="liuyao-decoration-v1";
export const THREE_NUMBER_ALGORITHM_ID="three-numbers-mod8-mod6";
export const THREE_NUMBER_ALGORITHM_VERSION="v1";
export const METHOD_PROFILE_ID="zengshan-single-cast-v1";
export const QUESTION_PARSER_VERSION="question-context-v1";
export class CoreInputError extends Error { constructor(public readonly code:string,message:string){super(message)} }
function validTimezone(value:string){try{Intl.DateTimeFormat("en-US",{timeZone:value});return true}catch{return false}}
function unknownField<T>():QuestionField<T>{return{value:null,provenance:"unknown",verification_status:"unknown"}}

export function freezeCastInput(input:DivinationCastRequest,now=new Date(),serverTimezone="UTC"):CoreCastReceipt {
  if(input.method!=="three_numbers")throw new CoreInputError("INVALID_CASTING_METHOD","仅支持三个数字起卦。");
  if(!Array.isArray(input.numbers)||input.numbers.length!==3||!input.numbers.every(Number.isSafeInteger))throw new CoreInputError("INVALID_THREE_NUMBERS","必须按顺序提供三个安全整数；数值范围由已接入的旧算法校验。");
  const timezone=input.timezone?.trim()||serverTimezone;
  if(!validTimezone(timezone))throw new CoreInputError("INVALID_TIMEZONE","时区必须是有效的 IANA 时区。");
  if(!validTimezone(serverTimezone))throw new CoreInputError("INVALID_SERVER_TIMEZONE","服务端默认时区无效。");
  const timestamp=now.toISOString(),rawNumbers=[...input.numbers] as NumberTriple;
  if(rawNumbers.some(number=>number<=0))throw new CoreInputError("INVALID_THREE_NUMBERS","当前三数字算法只接受正整数。");
  return {request_id:input.request_id||crypto.randomUUID(),cast_id:crypto.randomUUID(),raw_numbers:rawNumbers,validated_numbers:[...rawNumbers] as NumberTriple,raw_question:input.question,submitted_at:timestamp,cast_at:timestamp,timezone,timezone_source:input.timezone?.trim()?"client":"server_default",casting_algorithm_id:THREE_NUMBER_ALGORITHM_ID,casting_algorithm_version:THREE_NUMBER_ALGORITHM_VERSION,calendar_policy_id:"shanghai-jie-midnight-water-earth-v1",core_version:CORE_VERSION,method_profile_id:METHOD_PROFILE_ID,method_profile_version:"1",question_parser_version:QUESTION_PARSER_VERSION};
}

export function emptyQuestionContext(rawQuestion:string):QuestionContext { return {raw_question:rawQuestion,initiator:unknownField(),number_provider:unknownField(),perspective_person:unknownField(),goal:unknownField(),question_kind:unknownField(),ambiguities:[],goal_groups:[]}; }
export function buildAnalysisPlan(context:QuestionContext):AnalysisPlan {
  const needsClarification=!context.goal.value||context.ambiguities.length>0||context.goal_groups.length>1;
  return {goal_id:context.goal.value,candidate_ids:[],required_rule_types:["subject_relation","object_classification","topic_override","missing_candidate","multiple_candidates","supporting_roles"],required_fact_ids:[],missing_fact_ids:[],allowed_topics:context.goal.value?[context.goal.value]:[],forbidden_expansions:["invented_chart_facts","automatic_recast","silent_goal_change","unreviewed_rules"],timing_requested:context.question_kind.value==="timing",precision_limit:needsClarification?"insufficient":"conditional",status:needsClarification?"needs_clarification":"blocked_pending_rules"};
}
