import type { FactCatalog } from "./analysis-facts";
import type { SingleQuestionAnalysis } from "./question-analysis";
import { TASK_KINDS, TOPICS, KIND_TOPICS, TOPIC_TAXONOMY_VERSION, type TaskKind, type TopicId } from "./topic-taxonomy";
import { analysisHash, freezeAnalysis } from "./analysis-utils";
import { plannerRequirements, missingCoverage, supportsTaskKind, TASK_FACT_CONTRACT, PLANNER_MAX_TASKS } from "./planner-contract";
import { PlannerValidationError, plannerPremiseIssues, type PlannerValidationIssue } from "./planner-validation";
import { plannerFactDescription } from "./planner-description";
import type { LiuyaoCoreFacts } from "../contracts/divination";

export const ANALYSIS_PLAN_VERSION="initial-analysis-plan-v1";
export const ANALYSIS_PLAN_PROMPT_VERSION="p1-production-v31.2";
export interface AnalysisTask {
  task_id:string; kind:TaskKind; fact_refs:string[]; topic_ids:TopicId[]; retrieval_question:string;
  depends_on:string[]; priority:"critical"|"high"|"optional"; why_needed:string;
}
export interface InitialAnalysisPlan {
  version:typeof ANALYSIS_PLAN_VERSION; chart_hash:string; question_hash:string; taxonomy_version:string; prompt_version:string;
  status:"generated"|"fallback"; tasks:AnalysisTask[]; warnings:string[]; plan_hash:string;
  generation_mode?:"deterministic"|"llm"; generator_version?:string;
}
export function taskRequirements(facts:FactCatalog,question:SingleQuestionAnalysis){
  return plannerRequirements(facts,question);
}

export function inspectAnalysisPlan(value:unknown,facts:FactCatalog,question:SingleQuestionAnalysis,core?:LiuyaoCoreFacts){
  const issues:PlannerValidationIssue[]=[];
  const add=(code:string,path:string,message:string,extra:Partial<PlannerValidationIssue>={})=>issues.push({code,path,message,...extra});
  if(question.status!=="valid")add("PLAN_QUESTION_UNRESOLVED","$","问事尚未确认唯一有效。");
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>k!=="tasks")){
    add("PLAN_SCHEMA_INVALID","$","只允许 tasks；不能输出或改写用神、卦盘和问事。");return {tasks:[] as AnalysisTask[],issues};
  }
  const rawTasks=(value as {tasks?:unknown}).tasks;
  if(!Array.isArray(rawTasks)||!rawTasks.length){add("PLAN_SCHEMA_INVALID","tasks","tasks 必须为非空数组。");return {tasks:[] as AnalysisTask[],issues};}
  if(rawTasks.length>PLANNER_MAX_TASKS)add("PLAN_MAX_TASKS_EXCEEDED","tasks","任务数超过上限。",{received:rawTasks.length,expected:PLANNER_MAX_TASKS});
  const requirements=taskRequirements(facts,question);
  const tasks:AnalysisTask[]=[];
  rawTasks.slice(0,30).forEach((raw,index)=>{
    const base="tasks["+index+"]",before=issues.length;
    if(!raw||typeof raw!=="object"||Array.isArray(raw)){add("PLAN_SCHEMA_INVALID",base,"任务必须为对象。");return;}
    const t=raw as Record<string,unknown>,id=typeof t.task_id==="string"?t.task_id:undefined;
    const issue=(code:string,field:string,message:string,extra:Partial<PlannerValidationIssue>={})=>add(code,base+"."+field,message,{task_id:id,received:t[field],...extra});
    if(Object.keys(t).some(k=>!["task_id","kind","fact_refs","topic_ids","retrieval_question","depends_on","priority","why_needed"].includes(k)))issue("PLAN_SCHEMA_INVALID","$","任务含不允许的字段。");
    if(typeof id!=="string"||!/^[A-Za-z0-9_-]{1,64}$/.test(id))issue("PLAN_SCHEMA_INVALID","task_id","task_id 必须为唯一短标识。");
    if(!TASK_KINDS.includes(t.kind as TaskKind)){issue("PLAN_KIND_INVALID","kind","kind 不在允许枚举中。",{expected:TASK_KINDS});return;}
    const kind=t.kind as TaskKind;
    if(!["critical","high","optional"].includes(String(t.priority)))issue("PLAN_PRIORITY_INVALID","priority","priority 不合法。",{expected:["critical","high","optional"]});
    const strings=(field:string,max=64):string[]=>{
      const x=t[field];
      if(!Array.isArray(x)||x.length>max||x.some(v=>typeof v!=="string"||!v||v.length>100)||new Set(x).size!==x.length){issue("PLAN_SCHEMA_INVALID",field,"应为有界、非空字符串元素且不重复的数组。");return [];}
      return x;
    };
    const refs=strings("fact_refs"),topics=strings("topic_ids",6),depends=strings("depends_on",7);
    for(const [i,ref] of refs.entries())if(!facts.facts.some(f=>f.fact_id===ref))issue("PLAN_FACT_REF_INVALID","fact_refs["+i+"]","事实 ID 不属于当前冻结目录。",{received:ref,expected:facts.facts.map(f=>f.fact_id),suggested_action:"replace_fact_ref"});
    if(!topics.length)issue("PLAN_TOPIC_INVALID","topic_ids","至少需要一个合法主题。",{expected:KIND_TOPICS[kind],suggested_action:"replace_topic"});
    for(const [i,topic] of topics.entries()){
      if(!Object.hasOwn(TOPICS,topic))issue("PLAN_TOPIC_INVALID","topic_ids["+i+"]","主题不在现有白名单中。",{received:topic,expected:Object.keys(TOPICS),suggested_action:"replace_topic"});
      else if(!KIND_TOPICS[kind].includes(topic as TopicId))issue("PLAN_KIND_TOPIC_MISMATCH","topic_ids["+i+"]","主题与 kind 不匹配。",{received:topic,expected:KIND_TOPICS[kind],suggested_action:"replace_topic"});
    }
    const selected=facts.facts.filter(f=>refs.includes(f.fact_id));
    if(kind==="timing"&&!requirements.timing)issue("PLAN_TIMING_UNSUPPORTED","kind","问事没有问时或非当前时点的期限。");
    if(kind!=="timing"&&!refs.length)issue("PLAN_FACTS_REQUIRED","fact_refs","此类任务必须绑定冻结事实。");
    if(!supportsTaskKind(kind,selected)){
      const codes:Record<TaskKind,string>={role_condition:"PLAN_ROLE_FACT_REQUIRED",moving_transformation:"PLAN_MOVING_UNSUPPORTED",month_day_effect:"PLAN_CONDITION_UNSUPPORTED",hidden_condition:"PLAN_HIDDEN_UNSUPPORTED",line_relationship:"PLAN_RELATION_UNSUPPORTED",timing:"PLAN_TIMING_UNSUPPORTED"};
      issue(codes[kind],"fact_refs","引用事实不符合此任务类型的支持条件。",{related_fact_refs:refs,expected:TASK_FACT_CONTRACT[kind],suggested_action:"change_kind"});
    }
    if(kind==="role_condition")for(const topic of topics)if(["officials","wealth","parents","siblings","offspring"].includes(topic)&&!selected.some(f=>f.type==="role_binding"&&(f.value as {role:string}).role===topic))issue("PLAN_ROLE_TOPIC_MISMATCH","topic_ids","角色主题必须有对应程序角色绑定，不能重新取用。",{suggested_action:"replace_topic"});
    const text=(field:string):string=>{
      const x=t[field];if(typeof x!=="string"||!x.trim()||x.length>500){issue("PLAN_SCHEMA_INVALID",field,"应为不超过500字的非空文本。");return "";}return x;
    };
    const retrieval_question=text("retrieval_question"),why_needed=text("why_needed");
    if(retrieval_question&&!/[？?]$/.test(retrieval_question))issue("PLAN_PREJUDGED_CONCLUSION","retrieval_question","研究问题必须以问号结尾，不直接输出结论。");
    for(const [field,text] of [["retrieval_question",retrieval_question],["why_needed",why_needed]]){
      issues.push(...plannerPremiseIssues(text,base+"."+field,id??"",facts,core));
      if(/必然|一定会|肯定会|必吉|必凶|注定|喜欢你|讨厌你/.test(text)&&!/(?:是否|不能认定|不得断言|不代表)[^。；]*(?:必然|一定会|肯定会|必吉|必凶|注定)/.test(text))issue("PLAN_PREJUDGED_CONCLUSION",field,"不能预先断定吉凶或现实结果。");
    }
    if(issues.length===before)tasks.push({task_id:id!,kind,fact_refs:refs,topic_ids:topics as TopicId[],retrieval_question,why_needed,depends_on:depends,priority:t.priority as AnalysisTask["priority"]});
  });
  const ids=new Set<string>(),signatures=new Set<string>();
  for(const task of tasks){
    if(ids.has(task.task_id))add("PLAN_DUPLICATE_TASK_ID","tasks","task_id 重复。",{task_id:task.task_id});ids.add(task.task_id);
    const signature=analysisHash([task.kind,[...task.fact_refs].sort(),[...task.topic_ids].sort()]);
    if(signatures.has(signature))add("PLAN_DUPLICATE_TASK","tasks","任务理论与事实重复。",{task_id:task.task_id});signatures.add(signature);
    for(const dependency of task.depends_on)if(!tasks.some(t=>t.task_id===dependency))add("PLAN_DEPENDENCY_INVALID","tasks."+task.task_id+".depends_on","依赖任务不存在或该任务本身非法。",{task_id:task.task_id,received:dependency,expected:tasks.map(t=>t.task_id)});
  }
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string)=>{
    if(done.has(id))return;
    if(visiting.has(id)){add("PLAN_DEPENDENCY_CYCLE","tasks."+id+".depends_on","依赖成环。",{task_id:id});return;}
    const task=tasks.find(t=>t.task_id===id);if(!task)return;
    visiting.add(id);task.depends_on.forEach(visit);visiting.delete(id);done.add(id);
  };tasks.forEach(task=>visit(task.task_id));
  for(const gap of missingCoverage(tasks,facts,question))add("PLAN_REQUIRED_COVERAGE_MISSING","coverage_contract."+gap.coverage_id,"强制覆盖未由符合类型及优先级的任务完成。",{
    coverage_id:gap.coverage_id,related_fact_refs:gap.missing_fact_refs,expected:{kind:gap.required_kind,minimum_priority:gap.minimum_priority,completion:gap.completion},
    received:rawTasks.filter(t=>t&&typeof t==="object"&&Array.isArray(t.fact_refs)&&t.fact_refs.some((ref:string)=>gap.missing_fact_refs.includes(ref))).map(t=>({task_id:t.task_id,kind:t.kind,priority:t.priority})),suggested_action:"add_coverage"});
  return {tasks,issues};
}

export function validateAnalysisPlan(value:unknown,facts:FactCatalog,question:SingleQuestionAnalysis,questionHash:string,status:"generated"|"fallback"="generated",warnings:string[]=[],core?:LiuyaoCoreFacts,source?:{generation_mode:"deterministic"|"llm";generator_version:string}):InitialAnalysisPlan{
  const {tasks,issues}=inspectAnalysisPlan(value,facts,question,core);
  if(issues.length)throw new PlannerValidationError(issues);
  const plan:Omit<InitialAnalysisPlan,"plan_hash">={version:ANALYSIS_PLAN_VERSION,chart_hash:facts.chart_hash,question_hash:questionHash,taxonomy_version:TOPIC_TAXONOMY_VERSION,prompt_version:source?.generation_mode==="deterministic"?"not-applicable":ANALYSIS_PLAN_PROMPT_VERSION,status,tasks,warnings,...source};
  return freezeAnalysis({...plan,plan_hash:analysisHash(plan)});
}
export function minimumAnalysisPlan(facts:FactCatalog,question:SingleQuestionAnalysis,questionHash:string,reason:string,core?:LiuyaoCoreFacts):InitialAnalysisPlan{
  const r=taskRequirements(facts,question),tasks:AnalysisTask[]=[];
  const add=(kind:TaskKind,refs:string[],topics:TopicId[],query:string,priority:AnalysisTask["priority"]="high")=>{
    if(!refs.length&&kind!=="timing")return;
    tasks.push({task_id:`T${tasks.length+1}`,kind,fact_refs:refs,topic_ids:topics,retrieval_question:query,depends_on:[],priority,why_needed:kind==="timing"?"问事明确要求时间或限定期限":"冻结事实目录存在相应结构，需要检索定义、条件和例外"});
  };
  const describe=(refs:string[])=>facts.facts.filter(f=>refs.includes(f.fact_id)).map(f=>plannerFactDescription(f,facts,core)).join("；").slice(0,300);
  const labelsFor=(refs:string[])=>{const subjects=new Set(facts.facts.filter(f=>refs.includes(f.fact_id)).map(f=>f.subject_ref));return facts.facts.filter(f=>subjects.has(f.subject_ref)&&f.type==="month_seasonal_label"&&f.value!==null).map(f=>f.fact_id);};
  const roleRefs=[...new Set([...r.role,...labelsFor(r.role)])],conditionRefs=[...new Set([...r.conditions,...labelsFor(r.conditions)])];
  const context=question.domain==="career"&&question.event_type==="new_job"?"当前求职入职占事":`当前${question.domain}/${question.event_type}占事`;
  add("role_condition",roleRefs,["use_role"],`${describe(roleRefs)}；${context}中，主要角色的状态与作用需要核验哪些理论定义、条件和例外？`,"critical");
  const sameElement=facts.facts.some(f=>r.moving.includes(f.fact_id)&&f.value&&(f.value as {from_element:string;to_element:string}).from_element===(f.value as {to_element:string}).to_element);
  add("moving_transformation",r.moving,["moving_line","transformation",...(sameElement?["advance_retreat" as const]:[])],`${describe(r.moving)}；其动变${sameElement?"及进退神分类":"作用"}需要核验哪些定义、成立条件和例外？`);
  add("month_day_effect",conditionRefs,["day_month",...([...new Set(facts.facts.filter(f=>r.conditions.includes(f.fact_id)&&f.type!=="month_seasonal_label").map(f=>f.type))] as TopicId[])],`${describe(conditionRefs)}；这些局部标记在${context}中如何权衡，需要核验哪些成立条件和例外？`);
  add("hidden_condition",r.hidden,["hidden_spirit"],`${describe(r.hidden)}；与主要角色有关的飞伏作用需要核验哪些适用条件和例外？`);
  add("line_relationship",r.relationships,["self_response","generation_restriction"],`${describe(r.relationships)}；这一程序方向关系在${context}中需要核验哪些作用条件和例外？`);
  if(r.timing)add("timing",[],["timing"],`问事时间要求为${question.time_constraint?.expression??"何时发生"}；基于共享 calendar_context，界定该时间窗口的应期理论需要核验哪些前提与例外？`,"high");
  return validateAnalysisPlan({tasks},facts,question,questionHash,"fallback",[reason],core);
}
