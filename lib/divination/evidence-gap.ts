import type { InitialAnalysisPlan } from "./analysis-plan";
import type { FactCatalog } from "./analysis-facts";
import type { SingleQuestionAnalysis } from "./question-analysis";
import type { EvidenceSnapshot } from "./evidence-accumulator";
import { compileRetrievalRequests, type RetrievalRequest, type CompiledRetrievalPlan } from "./query-compiler";
import { TOPICS, type TopicId } from "./topic-taxonomy";
import { analysisHash, canonicalAnalysis, freezeAnalysis } from "./analysis-utils";

export const GAP_ANALYZER_VERSION="evidence-gap-v1";
export type GapTrigger = {type:"task_gap";task_id:string;reason:"no_results"|"low_relevance"|"insufficient_coverage"}
  |{type:"source_gap";task_id:string;evidence_id:string;source_span_id:string;reason:"missing_definition"|"missing_condition"|"missing_exception"|"source_conflict"};
export interface GapRecord {gap_id:string;trigger:GapTrigger;description:string;assessment:"machine"|"candidate"}
export interface SupplementalTask {
  extension_id:string;parent_task_id:string;trigger:GapTrigger|{type:"frozen_fact";parent_task_id:string;fact_id:string;reason:"unplanned_relevant_fact"};
  topic_ids:TopicId[];fact_refs:string[];retrieval_question:string;purpose:"resolve_dependency";status:"proposed"|"approved"|"rejected";
  definitions_only?:boolean;rejection_reason?:string;
}
export interface GapAnalysis {decision:"stop"|"retrieve_more";gaps:GapRecord[];supplemental_tasks:SupplementalTask[];additional_requests:RetrievalRequest[];stop_reason:string|null;compiled?:CompiledRetrievalPlan;validation_issues?:import("./gap-proposals").ValidationIssue[];diagnostic_run_id?:string}
export interface GapContext {plan:InitialAnalysisPlan;facts:FactCatalog;question:SingleQuestionAnalysis;evidence:EvidenceSnapshot}
const id=(s:unknown):s is string=>typeof s==="string"&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("GAP_SCHEMA_INVALID");return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=="string"||!v.trim()||v.length>500||/必然|必吉|必凶|一定会|注定/.test(v))throw new Error("GAP_TEXT_INVALID");return v;};
function keys(v:Record<string,unknown>,allowed:string[]){if(Object.keys(v).some(k=>!allowed.includes(k)))throw new Error("GAP_SCHEMA_INVALID");}
function list(v:unknown,max:number):unknown[]{if(!Array.isArray(v)||v.length>max)throw new Error("GAP_SCHEMA_INVALID");return v;}
export function taskTraces(context:GapContext,taskId:string){return context.evidence.retrieval_history.flatMap(h=>h.pack.retrieval_trace??[]).filter(t=>t.parent_task_id===taskId&&typeof t.keyword_hits==="number"&&typeof t.vector_hits==="number");}
export function machineGaps(context:GapContext):GapRecord[]{
  return context.plan.tasks.filter(t=>t.priority!=="optional"&&!context.evidence.evidence.some(e=>e.task_ids.includes(t.task_id))).map((t,i)=>{
    const traces=taskTraces(context,t.task_id),empty=traces.length>0&&traces.every(t=>t.keyword_hits===0&&t.vector_hits===0);
    return {gap_id:`machine_${i+1}`,trigger:{type:"task_gap",task_id:t.task_id,reason:empty?"no_results":"insufficient_coverage"},description:empty?"本任务实际检索未召回候选。":"任务未执行或候选未进入证据预算；不能认定覆盖。",assessment:empty?"machine":"candidate"};
  });
}
function validateTrigger(raw:unknown,c:GapContext):GapTrigger{
  const v=obj(raw);const task=c.plan.tasks.find(t=>t.task_id===v.task_id);if(!task)throw new Error("GAP_TASK_INVALID");
  if(v.type==="task_gap"){
    keys(v,["type","task_id","reason"]);
    if(!["no_results","low_relevance","insufficient_coverage"].includes(String(v.reason)))throw new Error("GAP_REASON_INVALID");
    const traces=taskTraces(c,task.task_id);
    if(v.reason==="no_results"&&(!traces.length||traces.some(t=>t.keyword_hits!==0||t.vector_hits!==0)))throw new Error("GAP_NOT_EMPTY");
  }else if(v.type==="source_gap"){
    keys(v,["type","task_id","evidence_id","source_span_id","reason"]);
    if(!["missing_definition","missing_condition","missing_exception","source_conflict"].includes(String(v.reason)))throw new Error("GAP_REASON_INVALID");
    const record=c.evidence.evidence.find(e=>e.evidence_id===v.evidence_id&&e.task_ids.includes(task.task_id));
    if(!record||!record.origins.some(o=>o.source_span_id===v.source_span_id&&o.round===1))throw new Error("GAP_SOURCE_INVALID");
  }else throw new Error("GAP_TRIGGER_INVALID");
  return v as unknown as GapTrigger;
}
const topicFactTypes:Partial<Record<TopicId,string[]>>={hidden_spirit:["hidden_location"],month_break:["month_break"],xun_empty:["xun_empty"],day_clash:["day_clash"],moving_line:["moving"],transformation:["transformation"],generation_restriction:["line_relationship"],self_response:["role_binding","line_relationship"],use_role:["role_binding"]};
export function validateGapAnalysis(raw:unknown,c:GapContext):GapAnalysis{
  const v=obj(raw);keys(v,["decision","gaps","supplemental_tasks","additional_requests","stop_reason"]);
  if(!["stop","retrieve_more"].includes(String(v.decision))||!(v.stop_reason===null||typeof v.stop_reason==="string"&&v.stop_reason.length<=500))throw new Error("GAP_SCHEMA_INVALID");
  const gaps=list(v.gaps,10).map(raw=>{const g=obj(raw);keys(g,["gap_id","trigger","description"]);if(!id(g.gap_id))throw new Error("GAP_ID_INVALID");const trigger=validateTrigger(g.trigger,c);return {gap_id:g.gap_id,trigger,description:text(g.description),assessment:trigger.type==="task_gap"&&trigger.reason==="no_results"?"machine" as const:"candidate" as const};});
  if(new Set(gaps.map(g=>g.gap_id)).size!==gaps.length)throw new Error("GAP_ID_INVALID");
  const supplemental=list(v.supplemental_tasks,3).map(raw=>{
    const s=obj(raw);keys(s,["extension_id","parent_task_id","trigger","topic_ids","fact_refs","retrieval_question","purpose","status"]);
    const parent=c.plan.tasks.find(t=>t.task_id===s.parent_task_id);
    if(!parent||!id(s.extension_id)||s.purpose!=="resolve_dependency"||s.status!=="proposed")throw new Error("EXTENSION_PARENT_INVALID");
    const topics=list(s.topic_ids,3) as TopicId[],refs=list(s.fact_refs,10) as string[];
    if(!topics.length||topics.some(t=>!Object.hasOwn(TOPICS,t))||refs.some(r=>!c.facts.facts.some(f=>f.fact_id===r)))throw new Error("EXTENSION_REFERENCE_INVALID");
    const question=text(s.retrieval_question);if(!/[?？]$/.test(question))throw new Error("EXTENSION_QUESTION_INVALID");
    const trigger=obj(s.trigger);let supported=false;
    if(trigger.type==="frozen_fact"){
      keys(trigger,["type","parent_task_id","fact_id","reason"]);
      const fact=c.facts.facts.find(f=>f.fact_id===trigger.fact_id);
      const parentSubjects=c.facts.facts.filter(f=>parent.fact_refs.includes(f.fact_id)).flatMap(f=>[f.subject_ref,f.object_ref]);
      const flying=fact?.type==="hidden_location"&&fact.value&&typeof fact.value==="object"?(fact.value as {flying_line_ref?:string}).flying_line_ref:undefined;
      supported=trigger.parent_task_id===parent.task_id&&trigger.reason==="unplanned_relevant_fact"&&Boolean(fact&&(parentSubjects.includes(fact.subject_ref)||(flying&&parentSubjects.includes(flying)))&&refs.includes(fact.fact_id)&&!parent.fact_refs.includes(fact.fact_id)&&topics.every(t=>topicFactTypes[t]?.includes(fact.type)));
    }else{
      const valid=validateTrigger(trigger,c);
      const record=valid.type==="source_gap"?c.evidence.evidence.find(e=>e.evidence_id===valid.evidence_id):undefined;
      supported=valid.type==="source_gap"&&valid.task_id===parent.task_id&&Boolean(record&&topics.every(t=>[...TOPICS[t].terms,TOPICS[t].label].some(term=>record.text.includes(term)||record.text.includes(term.replaceAll("动","動").replaceAll("变","變").replaceAll("应","應")))));
    }
    return {extension_id:s.extension_id,parent_task_id:parent.task_id,trigger:s.trigger as SupplementalTask["trigger"],topic_ids:topics,fact_refs:refs,retrieval_question:question,purpose:"resolve_dependency" as const,
      status:supported?"approved" as const:"rejected" as const,definitions_only:topics.includes("hidden_spirit")&&!c.facts.facts.some(f=>f.type==="hidden_location"),...(supported?{}:{rejection_reason:"NO_GROUNDED_DEPENDENCY"})};
  });
  if(new Set(supplemental.map(s=>s.extension_id)).size!==supplemental.length||supplemental.some(s=>c.plan.tasks.some(t=>t.task_id===s.extension_id)))throw new Error("EXTENSION_ID_INVALID");
  const approved=supplemental.filter(s=>s.status==="approved");
  const requests=list(v.additional_requests,3).map(r=>structuredClone(obj(r)) as unknown as RetrievalRequest);
  for(const r of requests)if(!gaps.some(g=>g.trigger.task_id===r.parent_task_id)&&!approved.some(s=>s.parent_task_id===r.parent_task_id))throw new Error("QUERY_TRIGGER_REQUIRED");
  // Approved dependency topics are compiler input only; NEVER mutate immutable P1.
  const expanded={...c.plan,tasks:c.plan.tasks.map(t=>({...t,topic_ids:[...new Set([...t.topic_ids,...approved.filter(s=>s.parent_task_id===t.task_id).flatMap(s=>s.topic_ids)])],fact_refs:[...new Set([...t.fact_refs,...approved.filter(s=>s.parent_task_id===t.task_id).flatMap(s=>s.fact_refs)])]}))};
  for(const s of approved)if(requests.length<3&&!requests.some(r=>r.parent_task_id===s.parent_task_id&&s.topic_ids.every(t=>r.topic_ids.includes(t)))){
    const parent=c.plan.tasks.find(t=>t.task_id===s.parent_task_id)!;
    requests.push({request_id:`ext_${s.extension_id}`,parent_task_id:parent.task_id,target_type:"theory",topic_ids:s.topic_ids,semantic_intent:s.retrieval_question,keyword_terms:s.topic_ids.flatMap(t=>[TOPICS[t].terms[0]]),fact_refs:s.fact_refs,priority:parent.priority});
  }
  const history=c.evidence.retrieval_history.flatMap(h=>h.requests);
  const signature=(r:RetrievalRequest)=>analysisHash([r.target_type,[...r.topic_ids].sort(),r.semantic_intent.normalize("NFKC").replace(/\s/g,""),[...r.keyword_terms].sort()]);
  const querySignature=(r:RetrievalRequest)=>canonicalAnalysis([r.target_type,[...new Set(r.keyword_terms)].sort()]);
  const seen=new Set(history.map(signature)),actual=new Set(history.map(querySignature)),ids=new Set(history.map(r=>r.request_id));
  const novel=requests.filter(r=>{
    if(ids.has(r.request_id)||seen.has(signature(r))||actual.has(querySignature(r)))return false;
    seen.add(signature(r));actual.add(querySignature(r));ids.add(r.request_id);return true;
  });
  const priority={critical:0,high:1,optional:2};novel.sort((a,b)=>priority[a.priority]-priority[b.priority]);
  const limited=novel.filter((r,i)=>r.priority!=="optional"||novel.slice(0,i).filter(r=>r.priority==="optional").length<1);
  // Validate ALL proposals, including duplicates, before accepting the filtered set.
  if(requests.length)compileRetrievalRequests(expanded,c.facts,c.question,requests,2);
  const compiled=limited.length?compileRetrievalRequests(expanded,c.facts,c.question,limited,2):undefined;
  if(v.decision==="stop"&&requests.length)throw new Error("GAP_STOP_WITH_REQUESTS");
  const decision=v.decision==="retrieve_more"&&compiled?"retrieve_more":"stop";
  return freezeAnalysis({decision,gaps,supplemental_tasks:supplemental,additional_requests:decision==="retrieve_more"?limited:[],stop_reason:decision==="stop"?(v.stop_reason as string|null)??"NO_NOVEL_REQUESTS":null,compiled:decision==="retrieve_more"?compiled:undefined});
}
