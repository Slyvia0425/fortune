import type { LiuyaoCoreFacts, UseRoleAnalysis } from "../contracts/divination";
import type { FactCatalog } from "./analysis-facts";
import { extractAnalysisFacts } from "./analysis-facts";
import type { SingleQuestionAnalysis } from "./question-analysis";
import { canonicalAnalysis, freezeAnalysis } from "./analysis-utils";
import { TOPICS, KIND_TOPICS, TASK_KINDS } from "./topic-taxonomy";
import { coverageContract, plannerRequirements, PLANNER_CONTRACT_VERSION, PLANNER_MAX_TASKS, TASK_FACT_CONTRACT } from "./planner-contract";

export const PLANNER_INPUT_VERSION="p1-input-v31.2";
export interface PlannerAuthoritativeContext {core?:LiuyaoCoreFacts}
export function buildPlannerInput(question:SingleQuestionAnalysis,roles:UseRoleAnalysis,facts:FactCatalog,authority:PlannerAuthoritativeContext={}){
  const core=authority.core;
  if(core&&canonicalAnalysis(extractAnalysisFacts(core,roles,facts.chart_hash))!==canonicalAnalysis(facts))throw new Error("PLANNER_FROZEN_FACTS_MISMATCH");
  const lines=core?[...core.main_lines,...core.transformed_lines,...core.hidden_lines]:[];
  const missing:string[]=[];
  const lineView=(ref:string)=>{
    const line=lines.find(l=>l.ref===ref);
    const fact=(type:string)=>facts.facts.find(f=>f.subject_ref===ref&&f.type===type);
    const field=(key:string,value:unknown,path:string,factId?:string)=>{
      if(value===undefined||value===null)missing.push(`${ref}.${key}`);
      return {value:value??null,...(line?{core_path:path}:{}),...(factId?{fact_ref:factId}:{}),status:value===undefined||value===null?"missing":"present"};
    };
    return {line_ref:ref,kin:field("kin",line?.kin,`${ref}.kin`),branch:field("branch",line?.branch,`${ref}.branch`),element:field("element",line?.element,`${ref}.element`),
      moving:field("moving",line?.moving??fact("moving")?.value,`${ref}.moving`,fact("moving")?.fact_id),
      states:Object.fromEntries(["month_seasonal_label","month_break","day_clash","xun_empty"].map(key=>{const f=fact(key);return [key,field(key,f?.value,`${ref}.strength.${key}`,f?.fact_id)];})),
      overall_strength_status:field("overall_strength_status",line?.strength?.overall_strength_status,`${ref}.strength.overall_strength_status`)};
  };
  const bindings=facts.facts.filter(f=>f.type==="role_binding");
  const primary=bindings.filter(f=>(f.value as {priority:string}).priority==="primary");
  const self=bindings.filter(f=>(f.value as {role:string}).role==="self");
  const requirements=plannerRequirements(facts,question);
  const calendar=core?.calendar;
  const calendarFields=["calendar_time","calendar_timezone","month_branch","month_ganzhi","day_ganzhi","empty_branches","policy_id","provider"];
  const calendarMissing=calendarFields.filter(key=>calendar?.[key]===undefined||calendar?.[key]===null);
  return freezeAnalysis({version:PLANNER_INPUT_VERSION,contract_version:PLANNER_CONTRACT_VERSION,question_analysis:question,validated_use_roles:roles,fact_catalog:facts,
    allowed_task_kinds:TASK_KINDS,allowed_topics:TOPICS,kind_topics:KIND_TOPICS,required_coverage:requirements,coverage_contract:coverageContract(facts,question),task_fact_contract:TASK_FACT_CONTRACT,max_tasks:PLANNER_MAX_TASKS,
    optional_relevance:{fact_refs:facts.facts.filter(f=>(f.type==="hidden_location"||["month_break","day_clash","xun_empty"].includes(f.type)&&f.value===true||f.type==="month_seasonal_label"&&bindings.some(b=>b.subject_ref===f.subject_ref))&&!coverageContract(facts,question).some(c=>c.fact_refs.includes(f.fact_id))).map(f=>f.fact_id),note:"非必查：需结合当前问事与主辅角色说明相关性；月令局部标签不能单独推出综合旺衰。"},
    analysis_core_view:{status:core?"core_verified":"partial_core_missing",primary:primary.map(f=>({role:(f.value as {role:string}).role,binding_fact_ref:f.fact_id,...lineView(f.subject_ref)})),self:self.map(f=>({binding_fact_ref:f.fact_id,...lineView(f.subject_ref)})),
      key_relations:facts.facts.filter(f=>requirements.relationships.includes(f.fact_id)).map(f=>({source_ref:f.subject_ref,target_ref:f.object_ref,fact_ref:f.fact_id,value:f.value})),
      moving_transformations:facts.facts.filter(f=>requirements.moving.includes(f.fact_id)).map(f=>({from_ref:f.subject_ref,to_ref:f.object_ref,fact_ref:f.fact_id,value:f.value})),
      optional_line_context:[...new Set(facts.facts.filter(f=>f.type==="hidden_location").flatMap(f=>[f.subject_ref,(f.value as {flying_line_ref?:string}).flying_line_ref].filter((ref):ref is string=>!!ref)))].map(lineView),
      interpretation_boundary:"overall_strength requires contextual rule evaluation; no overall strength or advance/retreat conclusion is inferred",missing},
    calendar_context:{context_ref:"calendar_context",status:calendar?(calendarMissing.length?"partial":"present"):"missing",fields:calendar??null,source:calendar?"frozen_core.calendar":null,missing:calendarMissing,time_constraint:question.time_constraint??null},
  });
}
