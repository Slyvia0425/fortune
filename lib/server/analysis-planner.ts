import type { FrozenQuestionRecord, UseRoleAnalysis } from "../contracts/divination";
import { extractAnalysisFacts, verifiedRoles, FACT_CATALOG_VERSION, FACT_DERIVATION_VERSION, type FactCatalog } from "../divination/analysis-facts";
import { ANALYSIS_PLAN_PROMPT_VERSION, validateAnalysisPlan, type InitialAnalysisPlan } from "../divination/analysis-plan";
import { analysisHash, canonicalAnalysis, freezeAnalysis } from "../divination/analysis-utils";
import { QUESTION_ANALYSIS_PROMPT_VERSION, QUESTION_ANALYSIS_VERSION, validateQuestionAnalysis, type SingleQuestionAnalysis } from "../divination/question-analysis";
import { allowedPrimaryRuleIds, QUESTION_TAXONOMY_VERSION, TOPIC_TAXONOMY_VERSION } from "../divination/topic-taxonomy";
import { FIXED_USE_RULES } from "../divination/fixed-use-rules";
import { USE_ROLE_RULE_VERSION } from "../divination/deterministic-use-roles";
import { analyzeSingleQuestion, planAnalysisTasks } from "./analysis-planner-llm";
import { determineUseRoles, analysisModelProfile } from "./divination-llm";
import { PLANNER_INPUT_VERSION } from "../divination/planner-input";
import { PLANNER_CONTRACT_VERSION } from "../divination/planner-contract";
import { PLANNER_VALIDATOR_VERSION } from "../divination/planner-validation";
import { PLANNER_RECOVERY_VERSION } from "../divination/planner-recovery";
import { deterministicAnalysisPlan, DETERMINISTIC_PLANNER_VERSION } from "../divination/deterministic-analysis-plan";
import { traceNode } from "./case-trace";

export const PR3_PIPELINE_VERSION="analysis-planner-deterministic-v1";
export function plannerMode():"deterministic"|"llm"{
  const mode=process.env.LIUYAO_PLANNER_MODE??"deterministic";
  if(mode!=="deterministic"&&mode!=="llm")throw new Error("PLANNER_MODE_INVALID");
  return mode;
}
export function plannerVersions(){return {pipeline:PR3_PIPELINE_VERSION,question_schema:QUESTION_ANALYSIS_VERSION,question_taxonomy:QUESTION_TAXONOMY_VERSION,q1_prompt:QUESTION_ANALYSIS_PROMPT_VERSION,
  facts:FACT_CATALOG_VERSION,derivation:FACT_DERIVATION_VERSION,topic_taxonomy:TOPIC_TAXONOMY_VERSION,p1_mode:plannerMode(),p1_generator:DETERMINISTIC_PLANNER_VERSION,p1_prompt:ANALYSIS_PLAN_PROMPT_VERSION,p1_input:PLANNER_INPUT_VERSION,p1_contract:PLANNER_CONTRACT_VERSION,p1_validator:PLANNER_VALIDATOR_VERSION,p1_recovery:PLANNER_RECOVERY_VERSION,fixed_rules_profile:analysisHash([FIXED_USE_RULES,USE_ROLE_RULE_VERSION]),model_profile:analysisModelProfile()};}
export interface InitialPlannerSnapshot {
  pipeline_version:typeof PR3_PIPELINE_VERSION; status:"ready"; chart_id:string; chart_hash:string;
  confirmation_id:string; question_hash:string; versions:ReturnType<typeof plannerVersions>;
  question_analysis:SingleQuestionAnalysis; use_roles:UseRoleAnalysis; fact_catalog:FactCatalog; initial_plan:InitialAnalysisPlan;
}
export interface BlockedPlannerResult {status:"semantic_conflict"|"extraction_failed"|"unsupported"; reason_code:string; question_analysis?:SingleQuestionAnalysis; use_roles?:UseRoleAnalysis}
export function plannerCheckpointKey(saved:FrozenQuestionRecord):string{
  return analysisHash({chart_id:saved.cast.chart_id,chart_hash:saved.cast.chart_hash,confirmation_id:saved.confirmed_question?.confirmation_id,question_hash:saved.confirmed_question?.question_hash,versions:plannerVersions()});
}
export function validatePlannerCheckpoint(snapshot:InitialPlannerSnapshot,saved:FrozenQuestionRecord):InitialPlannerSnapshot{
  const confirmation=saved.confirmed_question,context=saved.question_context,core=saved.cast.core_facts;
  if(!confirmation||!context||!core||snapshot.status!=="ready"||snapshot.pipeline_version!==PR3_PIPELINE_VERSION
    ||snapshot.chart_id!==saved.cast.chart_id||snapshot.chart_hash!==saved.cast.chart_hash
    ||snapshot.confirmation_id!==confirmation.confirmation_id||snapshot.question_hash!==confirmation.question_hash
    ||canonicalAnalysis(snapshot.versions)!==canonicalAnalysis(plannerVersions()))throw new Error("PLANNER_CHECKPOINT_INVALID");
  const question=validateQuestionAnalysis(snapshot.question_analysis,context);
  const allowed=allowedPrimaryRuleIds(question.domain,question.event_type);
  if(question.status!=="valid"||!snapshot.use_roles.primary||(allowed&&!allowed.includes(snapshot.use_roles.primary.rule_id)))throw new Error("PLANNER_CHECKPOINT_INVALID");
  const roles=verifiedRoles(core,snapshot.use_roles,snapshot.chart_hash);
  const facts=extractAnalysisFacts(core,roles,snapshot.chart_hash);
  if(canonicalAnalysis(facts)!==canonicalAnalysis(snapshot.fact_catalog))throw new Error("PLANNER_CHECKPOINT_FACTS_INVALID");
  const initial=snapshot.initial_plan;
  if(!["generated","fallback"].includes(initial.status)||!Array.isArray(initial.warnings)||initial.warnings.some(w=>typeof w!=="string"))throw new Error("PLANNER_CHECKPOINT_INVALID");
  const mode=plannerMode(),generator=mode==="deterministic"?DETERMINISTIC_PLANNER_VERSION:ANALYSIS_PLAN_PROMPT_VERSION;
  if(initial.generation_mode!==mode||initial.generator_version!==generator)throw new Error("PLANNER_CHECKPOINT_SOURCE_INVALID");
  const plan=mode==="deterministic"?deterministicAnalysisPlan(question,roles,facts,confirmation.question_hash,core):validateAnalysisPlan({tasks:initial.tasks},facts,question,confirmation.question_hash,initial.status,initial.warnings,core,{generation_mode:mode,generator_version:generator});
  if(canonicalAnalysis(plan)!==canonicalAnalysis(initial))throw new Error("PLANNER_CHECKPOINT_PLAN_INVALID");
  return freezeAnalysis(snapshot);
}
export async function buildInitialAnalysisPlan(saved:FrozenQuestionRecord):Promise<InitialPlannerSnapshot|BlockedPlannerResult>{
  const confirmed=saved.confirmed_question,core=saved.cast.core_facts,context=saved.question_context;
  if(!confirmed||saved.confirmation_status!=="confirmed"||saved.question!==confirmed.normalized_question
    ||saved.cast.confirmation_id!==confirmed.confirmation_id||saved.cast.question_hash!==confirmed.question_hash)return {status:"extraction_failed",reason_code:"CONFIRMATION_MISMATCH"};
  if(!context||context.raw_question!==saved.question)return {status:"extraction_failed",reason_code:"CONFIRMED_CONTEXT_MISSING"};
  let question:SingleQuestionAnalysis;
  if(saved.question_analysis){
    try{
      if(saved.question_analysis.version!==QUESTION_ANALYSIS_VERSION||saved.question_analysis.taxonomy_version!==QUESTION_TAXONOMY_VERSION||saved.question_analysis.prompt_version!==QUESTION_ANALYSIS_PROMPT_VERSION)throw new Error("QUESTION_VERSION_MISMATCH");
      question=validateQuestionAnalysis(saved.question_analysis,context);
    }catch{return {status:"extraction_failed",reason_code:"FROZEN_QUESTION_ANALYSIS_INVALID"};}
  }else question=await analyzeSingleQuestion(context); // read-only PR-2 migration: never re-freeze
  if(question.status!=="valid")return {status:question.status,reason_code:question.issues[0]??"QUESTION_UNRESOLVED",question_analysis:question};
  if(!core?.main_lines_complete||!saved.cast.chart_hash)return {status:"unsupported",reason_code:"FROZEN_CORE_INCOMPLETE",question_analysis:question};
  const roles=await determineUseRoles(core,saved.question,saved.cast.chart_hash,context,question);
  if(roles.status!=="generated"||!roles.primary)return {status:roles.status==="unavailable"?"extraction_failed":"unsupported",reason_code:"USE_ROLE_UNRESOLVED",question_analysis:question,use_roles:roles};
  const allowed=allowedPrimaryRuleIds(question.domain,question.event_type);
  if(allowed&&!allowed.includes(roles.primary.rule_id))return {status:"unsupported",reason_code:"USE_RULE_EVENT_MISMATCH",question_analysis:question,use_roles:roles};
  let validatedRoles:UseRoleAnalysis,facts:FactCatalog;
  try{validatedRoles=verifiedRoles(core,roles,saved.cast.chart_hash);facts=extractAnalysisFacts(core,validatedRoles,saved.cast.chart_hash);}
  catch{return {status:"unsupported",reason_code:"FROZEN_ROLE_FACTS_INVALID",question_analysis:question,use_roles:roles};}
  const mode=plannerMode();
  const plan=mode==="deterministic"
    ?await traceNode("deterministic-analysis-planner",{generation_mode:mode,generator_version:DETERMINISTIC_PLANNER_VERSION,question,validated_use_roles:validatedRoles,fact_catalog:facts,core},()=>deterministicAnalysisPlan(question,validatedRoles,facts,confirmed.question_hash,core))
    :await (async()=>{const llm=await planAnalysisTasks(question,validatedRoles,facts,confirmed.question_hash,undefined,{core});return validateAnalysisPlan({tasks:llm.tasks},facts,question,confirmed.question_hash,llm.status,llm.warnings,core,{generation_mode:mode,generator_version:ANALYSIS_PLAN_PROMPT_VERSION});})();
  return freezeAnalysis({pipeline_version:PR3_PIPELINE_VERSION,status:"ready",chart_id:saved.cast.chart_id!,chart_hash:saved.cast.chart_hash,
    confirmation_id:confirmed.confirmation_id,question_hash:confirmed.question_hash,versions:plannerVersions(),question_analysis:question,use_roles:validatedRoles,fact_catalog:facts,initial_plan:plan});
}
