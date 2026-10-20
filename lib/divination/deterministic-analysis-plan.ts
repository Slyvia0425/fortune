import type { LiuyaoCoreFacts, UseRoleAnalysis } from "../contracts/divination";
import type { FactCatalog } from "./analysis-facts";
import { validateAnalysisPlan, type AnalysisTask } from "./analysis-plan";
import { buildPlannerInput } from "./planner-input";
import { plannerFactDescription } from "./planner-description";
import { plannerRequirements } from "./planner-contract";
import type { SingleQuestionAnalysis } from "./question-analysis";
import type { TaskKind, TopicId } from "./topic-taxonomy";

export const DETERMINISTIC_PLANNER_VERSION="deterministic-analysis-plan-v1";

/** A normal planning path, not a renamed recovery plan. Never chooses roles or rules. */
export function deterministicAnalysisPlan(question:SingleQuestionAnalysis,roles:UseRoleAnalysis,facts:FactCatalog,questionHash:string,core:LiuyaoCoreFacts){
  // Reconstruct and compare the catalog before describing any frozen data.
  buildPlannerInput(question,roles,facts,{core});
  const r=plannerRequirements(facts,question),tasks:AnalysisTask[]=[];
  const bindings=facts.facts.filter(f=>f.type==="role_binding");
  const important=new Set(bindings.filter(f=>(f.value as {priority:string;role:string}).priority==="primary"||(f.value as {role:string}).role==="self").map(f=>f.subject_ref));
  const states=facts.facts.filter(f=>important.has(f.subject_ref)&&["month_break","day_clash","xun_empty","month_seasonal_label"].includes(f.type));
  const describe=(refs:string[])=>facts.facts.filter(f=>refs.includes(f.fact_id)).map(f=>plannerFactDescription(f,facts,core)).join("；").slice(0,280);
  const add=(kind:TaskKind,refs:string[],topics:TopicId[],questionText:string,why:string,priority:AnalysisTask["priority"]="high")=>{
    tasks.push({task_id:`T${tasks.length+1}`,kind,fact_refs:[...new Set(refs)],topic_ids:[...new Set(topics)],retrieval_question:questionText,why_needed:why,depends_on:[],priority});
  };
  const roleRefs=bindings.map(f=>f.fact_id);
  const roleTopics=bindings.filter(f=>(f.value as {priority:string}).priority==="primary").map(f=>(f.value as {role:TopicId}).role).filter(t=>["officials","wealth","parents","siblings","offspring"].includes(t));
  add("role_condition",[...roleRefs,...(!r.conditions.length?states.map(f=>f.fact_id):[])],["use_role",...roleTopics],
    `${describe(roleRefs)}；针对已确认占事“${question.normalized_question.slice(0,100)}”，这些既定角色的状态和作用应核验哪些判断条件与例外？`,
    "沿用已验证取用及全部候选，不重新选择具体爻位；结构事实与规则适用条件分开。","critical");
  if(r.conditions.length){
    const flags=[...new Set(states.filter(f=>f.value===true).map(f=>f.type))] as TopicId[];
    add("month_day_effect",states.map(f=>f.fact_id),["day_month",...flags],
      `${describe(r.conditions)}；这些局部状态的定义、同时出现时的权衡条件及例外是什么？`,
      "覆盖主用与世爻的已知状态，并保留未知项；局部月令标签不作为综合旺衰或吉凶。","critical");
  }
  if(r.moving.length){
    const same=facts.facts.some(f=>r.moving.includes(f.fact_id)&&f.value&&(f.value as {from_element:string;to_element:string}).from_element===(f.value as {to_element:string}).to_element);
    const refs=new Set(facts.facts.filter(f=>r.moving.includes(f.fact_id)).flatMap(f=>[f.subject_ref,f.object_ref??""]));
    const returning=facts.facts.filter(f=>f.type==="line_relationship"&&refs.has(f.subject_ref)&&refs.has(f.object_ref??"")&&f.subject_ref.startsWith("transformed:"));
    add("moving_transformation",[...r.moving,...returning.map(f=>f.fact_id)],["moving_line","transformation",...(same?["advance_retreat" as const]:[])],
      `${describe(r.moving)}；上述动变及变爻对本爻的方向关系应核验哪些作用条件${same?"，进退神分类需要哪些定义与例外":"与例外"}？`,
      "程序只确定动变及结构关系；不自行断定进退神或有效回头生克。");
  }
  if(r.relationships.length)add("line_relationship",r.relationships,["self_response","generation_restriction"],
    `${describe(r.relationships)}；这些有向结构关系在当前占事中形成实际作用需要哪些条件及例外？`,
    "保留程序的源爻到目标爻方向；结构生克不等于有效作用或结果。");
  if(r.hidden.length){
    const hidden=new Set(facts.facts.filter(f=>r.hidden.includes(f.fact_id)).map(f=>f.subject_ref));
    const refs=facts.facts.filter(f=>f.type==="line_relationship"&&(hidden.has(f.subject_ref)||hidden.has(f.object_ref??""))).map(f=>f.fact_id);
    add("hidden_condition",[...r.hidden,...refs],["hidden_spirit"],`${describe(r.hidden)}；相关飞伏关系的可用、出伏条件与例外是什么？`,
      "只分析已绑定角色的伏藏，不把普通伏神自动提升为核心任务，不推断可用性。");
  }
  if(r.timing)add("timing",[],["timing"],`已确认时间要求为“${(question.time_constraint?.expression??"何时发生").slice(0,100)}”；结合冻结 calendar_context，判断该期限内的应期需要哪些前提、规则和例外？`,
    "保留原始期限与历法上下文；不补造绝对日期，规则不足时明确保留缺口。");
  return validateAnalysisPlan({tasks},facts,question,questionHash,"generated",[],core,{generation_mode:"deterministic",generator_version:DETERMINISTIC_PLANNER_VERSION});
}
