import type { InitialAnalysisPlan, AnalysisTask } from "./analysis-plan";
import type { FactCatalog } from "./analysis-facts";
import type { SingleQuestionAnalysis } from "./question-analysis";
import { TOPICS, KIND_TOPICS, type TopicId } from "./topic-taxonomy";
import { analysisHash, freezeAnalysis } from "./analysis-utils";

export const QUERY_COMPILER_VERSION = "controlled-query-compiler-v2-open-plan-topics";
export const RETRIEVAL_STRATEGY_VERSION = "task-theory-first-v1";
export const GAP_QUERY_ALIASES = {
  month_break:["破而不破","月破条件"], xun_empty:["真空","假空","出空"], hidden_spirit:["伏藏","飞伏","伏神条件"],
  moving_line:["动静条件"], transformation:["回头生","回头克"], advance_retreat:["化进","化退"], day_month:["日月生克"],
  day_clash:["暗动","日破"], generation_restriction:["生克条件"], self_response:["世应生克"],
  use_role:["用神条件"], timing:["应期前提"], officials:["官鬼条件"],wealth:["妻财条件"],parents:["父母条件"],siblings:["兄弟条件"],offspring:["子孙条件"],
} satisfies Record<TopicId,readonly string[]>;
export interface RetrievalRequest {
  request_id:string; parent_task_id:string; target_type:"theory"|"case";
  topic_ids:TopicId[]; semantic_intent:string; keyword_terms:string[];
  fact_refs:string[]; priority:AnalysisTask["priority"];
}
// Event aliases are recall hints, never SQL filters or equivalence claims.
const CASE_TERMS:Record<string,readonly string[]> = {
  new_job:["求职","求官"], interview_result:["面试","求官"], promotion:["升迁"],
  job_change:["调任"], job_offer_decision:["赴任"], hiring_other:["聘用"],
  reconciliation:["复合"], marriage:["婚姻"], relationship_formation:["婚恋"],
  debt_repayment:["索债"], investment_return:["求财"], exam_result:["考试","科举"],
  admission:["录取","科举"], recovery:["疾病","康复"], litigation:["诉讼"],
};
export interface CompiledRetrievalPlan {
  version:typeof QUERY_COMPILER_VERSION; strategy_version:typeof RETRIEVAL_STRATEGY_VERSION;
  chart_hash:string; plan_hash:string; round:1|2; requests:RetrievalRequest[];
  queries:{request_id:string;parent_task_id:string;round:1|2;lane:"theory"|"case";query:string;fact_refs:string[]}[];
  task_log:{task_id:string;status:"scheduled"|"budget_deferred";request_ids:string[]}[];
  warnings:string[]; compilation_hash:string;
}
const unique=<T>(values:T[])=>[...new Set(values)];
function theoryTerms(topics:readonly string[],task:AnalysisTask,round:1|2=1):string[]{
  const known=topics.filter((id):id is TopicId=>Object.hasOwn(TOPICS,id));
  const selected=known.length?known:KIND_TOPICS[task.kind];
  return unique(selected.flatMap(id=>[...TOPICS[id].terms,...(round===2?GAP_QUERY_ALIASES[id]:[])]));
}
export function initialRetrievalRequests(plan:InitialAnalysisPlan):RetrievalRequest[]{
  return plan.tasks.map((task,index)=>({request_id:`r1_${index+1}`,parent_task_id:task.task_id,target_type:"theory",
    topic_ids:[...task.topic_ids],semantic_intent:task.retrieval_question,
    keyword_terms:theoryTerms(task.topic_ids,task),fact_refs:[...task.fact_refs],priority:task.priority}));
}
export function compileRetrievalRequests(plan:InitialAnalysisPlan,facts:FactCatalog,question:SingleQuestionAnalysis,requests=initialRetrievalRequests(plan),round:1|2=1):CompiledRetrievalPlan {
  if(question.status!=="valid"||facts.chart_hash!==plan.chart_hash||requests.length>14)throw new Error("QUERY_INPUT_INVALID");
  const seen=new Set<string>();
  const validated=requests.map(r=>{
    if(!r||Object.keys(r).some(k=>!["request_id","parent_task_id","target_type","topic_ids","semantic_intent","keyword_terms","fact_refs","priority"].includes(k)))throw new Error("QUERY_SCHEMA_INVALID");
    const task=plan.tasks.find(t=>t.task_id===r.parent_task_id);
    if(!task||!/^[A-Za-z0-9_-]{1,64}$/.test(r.request_id)||seen.has(r.request_id)||!["theory","case"].includes(r.target_type)
      ||r.priority!==task.priority||typeof r.semantic_intent!=="string"||!r.semantic_intent.trim()||r.semantic_intent.length>500
      ||!Array.isArray(r.topic_ids)||r.topic_ids.some(id=>!task.topic_ids.includes(id))
      ||!Array.isArray(r.fact_refs)||r.fact_refs.some(id=>!task.fact_refs.includes(id)||!facts.facts.some(f=>f.fact_id===id)))throw new Error("QUERY_REFERENCE_INVALID");
    seen.add(r.request_id);
    const allowed=r.target_type==="case"?[...(CASE_TERMS[question.event_type]??[])]:theoryTerms(r.topic_ids,task,round);
    if(!Array.isArray(r.keyword_terms)||!r.keyword_terms.length||r.keyword_terms.length>20||r.keyword_terms.some(t=>!allowed.includes(t)))throw new Error("QUERY_TERM_INVALID");
    // Do not concatenate semantic_intent, user prose, branches or fact values.
    const query=unique(r.keyword_terms).join(" ");
    if(query.length>500)throw new Error("QUERY_TOO_LONG");
    return {request:r,query};
  });
  const order={critical:0,high:1,optional:2};
  const sorted=validated.sort((a,b)=>order[a.request.priority]-order[b.request.priority]);
  // First give each task one slot; extra requests must not starve another task.
  const first=sorted.filter((item,index)=>sorted.findIndex(r=>r.request.parent_task_id===item.request.parent_task_id)===index);
  const selected=[...first,...sorted.filter(r=>!first.includes(r))].slice(0,round===1?5:3);
  const queries=selected.map(({request:r,query})=>({request_id:r.request_id,parent_task_id:r.parent_task_id,round,lane:r.target_type,query,fact_refs:[...r.fact_refs]}));
  const task_log=plan.tasks.map(task=>({task_id:task.task_id,status:queries.some(q=>q.parent_task_id===task.task_id)?"scheduled" as const:"budget_deferred" as const,request_ids:queries.filter(q=>q.parent_task_id===task.task_id).map(q=>q.request_id)}));
  if(!queries.length)throw new Error("QUERY_EMPTY");
  const result:Omit<CompiledRetrievalPlan,"compilation_hash">={version:QUERY_COMPILER_VERSION,strategy_version:RETRIEVAL_STRATEGY_VERSION,chart_hash:plan.chart_hash,plan_hash:plan.plan_hash,round,
    requests,queries,task_log,warnings:[...(task_log.some(t=>t.status==="budget_deferred")?[round===1?"FIRST_ROUND_TASKS_DEFERRED":"SECOND_ROUND_NOT_ALL_TASKS_REQUESTED"]:[]),
      ...(requests.some(r=>!r.topic_ids.length||r.topic_ids.some(id=>!Object.hasOwn(TOPICS,id)))?["PLAN_TOPICS_OUTSIDE_DICTIONARY_USING_KNOWN_OR_TASK_TERMS"]:[])]};
  return freezeAnalysis({...result,compilation_hash:analysisHash(result)});
}
