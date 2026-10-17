import type { AnalysisFact, FactCatalog } from "./analysis-facts";
import type { SingleQuestionAnalysis } from "./question-analysis";
import type { AnalysisTask } from "./analysis-plan";
import type { TaskKind } from "./topic-taxonomy";

export const PLANNER_CONTRACT_VERSION="p1-contract-deterministic-v1";
export const PLANNER_MAX_TASKS=7;
export interface CoverageRequirement {
  coverage_id:string; required:boolean; required_kind:TaskKind; fact_refs:string[];
  minimum_priority:"high"; completion:"union_of_matching_tasks";
}
export function plannerRequirements(facts:FactCatalog,question:SingleQuestionAnalysis){
  const bindings=facts.facts.filter(f=>f.type==="role_binding");
  const important=bindings.filter(f=>{const v=f.value as {priority:string;role:string};return v.priority==="primary"||v.role==="self";});
  const refs=new Set(important.map(f=>f.subject_ref));
  const relevant=facts.facts.filter(f=>refs.has(f.subject_ref));
  const primary=new Set(bindings.filter(f=>(f.value as {priority:string}).priority==="primary").map(f=>f.subject_ref));
  const self=new Set(bindings.filter(f=>(f.value as {role:string}).role==="self").map(f=>f.subject_ref));
  // Keep the program's self -> primary direction, not both inverse descriptions.
  const key=facts.facts.filter(f=>f.type==="line_relationship"&&self.has(f.subject_ref)&&primary.has(f.object_ref??"")&&f.subject_ref!==f.object_ref);
  return {
    role:bindings.filter(f=>(f.value as {priority:string}).priority==="primary").map(f=>f.fact_id),
    moving:relevant.filter(f=>f.type==="transformation").map(f=>f.fact_id),
    conditions:relevant.filter(f=>["month_break","day_clash","xun_empty"].includes(f.type)&&f.value===true||f.type==="month_seasonal_label"&&typeof f.value==="string"&&!!f.value).map(f=>f.fact_id),
    hidden:relevant.filter(f=>f.type==="hidden_location").map(f=>f.fact_id),
    relationships:key.map(f=>f.fact_id),
    timing:question.question_type==="timing"||Boolean(question.time_constraint&&question.time_constraint.kind!=="present"),
  };
}
export function coverageContract(facts:FactCatalog,question:SingleQuestionAnalysis):CoverageRequirement[]{
  const r=plannerRequirements(facts,question);
  const contracts:CoverageRequirement[]=([["C_ROLE","role_condition",r.role],["C_MOVING","moving_transformation",r.moving],
    ["C_MONTH_DAY","month_day_effect",r.conditions],["C_HIDDEN","hidden_condition",r.hidden],
    ["C_RELATION","line_relationship",r.relationships]] as const)
    .filter(([,kind,refs])=>refs.length>0||kind==="role_condition")
    .map(([coverage_id,required_kind,fact_refs])=>({coverage_id,required:true,required_kind,fact_refs,minimum_priority:"high",completion:"union_of_matching_tasks"}));
  if(r.timing)contracts.push({coverage_id:"C_TIMING",required:true,required_kind:"timing",fact_refs:[],minimum_priority:"high",completion:"union_of_matching_tasks"});
  return contracts;
}
export function missingCoverage(tasks:readonly AnalysisTask[],facts:FactCatalog,question:SingleQuestionAnalysis){
  return coverageContract(facts,question).flatMap(contract=>{
    const missing=contract.fact_refs.filter(ref=>!tasks.some(task=>task.kind===contract.required_kind&&task.priority!=="optional"&&task.fact_refs.includes(ref)));
    const missingTask=contract.coverage_id==="C_TIMING"&&!tasks.some(t=>t.kind==="timing"&&t.priority!=="optional");
    return missing.length||missingTask||contract.coverage_id==="C_ROLE"&&!contract.fact_refs.length?[{...contract,missing_fact_refs:missing}]:[];
  });
}
export function supportsTaskKind(kind:TaskKind,selected:readonly AnalysisFact[]):boolean{
  switch(kind){
    case "role_condition":return selected.some(f=>f.type==="role_binding");
    case "moving_transformation":return selected.some(f=>f.type==="transformation"||f.type==="moving"&&f.value===true);
    case "month_day_effect":return selected.some(f=>["month_break","day_clash","xun_empty"].includes(f.type)&&f.value===true||f.type==="month_seasonal_label"&&typeof f.value==="string"&&!!f.value);
    case "hidden_condition":return selected.some(f=>f.type==="hidden_location");
    case "line_relationship":return selected.some(f=>f.type==="line_relationship");
    case "timing":return true;
  }
}
export const TASK_FACT_CONTRACT={
  role_condition:"至少引用一个程序 role_binding；不重新取用",
  moving_transformation:"引用 transformation 或 moving=true",
  month_day_effect:"引用 month_break/day_clash/xun_empty=true，或已存在的 month_seasonal_label；局部标签不等于综合旺衰",
  hidden_condition:"引用 hidden_location；非主用相关的伏神不强制覆盖",
  line_relationship:"引用程序 line_relationship，保持其方向",
  timing:"仅在问题有问时或期限时允许；共享 calendar_context，不必伪造 fact_refs",
};
