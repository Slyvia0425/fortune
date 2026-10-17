import { analysisHash } from "./analysis-utils";
import { validateGapAnalysis, type GapContext, type GapAnalysis, type SupplementalTask, type GapTrigger } from "./evidence-gap";
import { GAP_QUERY_ALIASES, type RetrievalRequest } from "./query-compiler";
import { TOPICS, type TopicId } from "./topic-taxonomy";

export interface ValidationIssue {
  code: "UNKNOWN_TASK"|"UNKNOWN_TOPIC"|"INVALID_FACT_REF"|"TOPIC_NOT_ALLOWED"|"PRIORITY_MISMATCH"|"MISSING_TRIGGER_EVIDENCE"|"DUPLICATE_QUERY"|"BUDGET_DEFERRED"|"SCHEMA_INVALID"|"INVALID_JSON"|"MODEL_FAILED";
  path: string; received: unknown; expected?: unknown;
}
export class GapProposalError extends Error {
  constructor(public readonly issues: ValidationIssue[]) { super("GAP_PROPOSAL_INVALID"); }
}
interface Anchor { anchor_id:string; parent_task_id:string; topic_ids:TopicId[]; fact_refs:string[]; trigger:SupplementalTask["trigger"] }
const factTypes:Partial<Record<TopicId,string[]>>={hidden_spirit:["hidden_location"],month_break:["month_break"],xun_empty:["xun_empty"],day_clash:["day_clash"],moving_line:["moving"],transformation:["transformation"],generation_restriction:["line_relationship"],self_response:["role_binding","line_relationship"],use_role:["role_binding"]};
// Handles are derived from frozen data, never supplied by the model itself.
export function gapProposalAnchors(c:GapContext):Anchor[] {
  const anchors:Anchor[]=[];
  const add=(a:Omit<Anchor,"anchor_id">)=>anchors.push({...a,anchor_id:`A_${analysisHash(a).slice(0,20)}`});
  for(const task of c.plan.tasks){
    for(const record of c.evidence.evidence.filter(e=>e.task_ids.includes(task.task_id))){
      const topics=(Object.keys(TOPICS) as TopicId[]).filter(t=>[...TOPICS[t].terms,TOPICS[t].label].some(term=>record.text.includes(term)||record.text.includes(term.replaceAll("动","動").replaceAll("变","變").replaceAll("应","應"))));
      for(const origin of record.origins.filter(o=>o.round===1))add({parent_task_id:task.task_id,topic_ids:topics,fact_refs:[],trigger:{type:"source_gap",task_id:task.task_id,evidence_id:record.evidence_id,source_span_id:origin.source_span_id,reason:"missing_condition"}});
    }
    const subjects=c.facts.facts.filter(f=>task.fact_refs.includes(f.fact_id)).flatMap(f=>[f.subject_ref,f.object_ref]);
    for(const fact of c.facts.facts){
      const flying=fact.type==="hidden_location"&&fact.value&&typeof fact.value==="object"?(fact.value as {flying_line_ref?:string}).flying_line_ref:undefined;
      if(task.fact_refs.includes(fact.fact_id)||fact.value===null||fact.value===false||(!subjects.includes(fact.subject_ref)&&!(flying&&subjects.includes(flying))))continue;
      const topics=(Object.keys(factTypes) as TopicId[]).filter(t=>factTypes[t]?.includes(fact.type));
      if(topics.length)add({parent_task_id:task.task_id,topic_ids:topics,fact_refs:[fact.fact_id],trigger:{type:"frozen_fact",parent_task_id:task.task_id,fact_id:fact.fact_id,reason:"unplanned_relevant_fact"}});
    }
  }
  return anchors;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export function compileGapProposals(raw:unknown,c:GapContext):GapAnalysis {
  const issues:ValidationIssue[]=[];
  const issue=(code:ValidationIssue["code"],path:string,received:unknown,expected?:unknown)=>issues.push({code,path,received:received??null,...(expected===undefined?{}:{expected})});
  if(!object(raw))throw new GapProposalError([{code:"SCHEMA_INVALID",path:"$",received:raw??null,expected:"object"}]);
  for(const key of Object.keys(raw))if(!["decision","proposals","stop_reason"].includes(key))issue("SCHEMA_INVALID",key,raw[key],"omit");
  if(!["stop","retrieve_more"].includes(String(raw.decision)))issue("SCHEMA_INVALID","decision",raw.decision,["stop","retrieve_more"]);
  if(!Array.isArray(raw.proposals)||raw.proposals.length>3)issue("SCHEMA_INVALID","proposals",raw.proposals,"array, maximum 3");
  if(raw.stop_reason!==undefined&&raw.stop_reason!==null&&(typeof raw.stop_reason!=="string"||raw.stop_reason.length>500))issue("SCHEMA_INVALID","stop_reason",raw.stop_reason,"string <=500 or null");
  const anchors=gapProposalAnchors(c), requests:RetrievalRequest[]=[], extensions:SupplementalTask[]=[], gaps:{gap_id:string;trigger:GapTrigger;description:string}[]=[];
  for(const [i,p] of (Array.isArray(raw.proposals)?raw.proposals.slice(0,3):[]).entries()){
    const path=`proposals[${i}]`, before=issues.length;
    if(!object(p)){issue("SCHEMA_INVALID",path,p,"object");continue;}
    for(const key of Object.keys(p))if(!["parent_task_id","trigger_type","topic_ids","knowledge_need","trigger_ref"].includes(key))issue(key==="priority"?"PRIORITY_MISMATCH":key==="fact_refs"?"INVALID_FACT_REF":"SCHEMA_INVALID",`${path}.${key}`,p[key],"program-owned field; omit");
    const parent=c.plan.tasks.find(t=>t.task_id===p.parent_task_id);
    if(!parent)issue("UNKNOWN_TASK",`${path}.parent_task_id`,p.parent_task_id,c.plan.tasks.map(t=>t.task_id));
    const topics=Array.isArray(p.topic_ids)?p.topic_ids:[];
    if(!topics.length||topics.length>3||new Set(topics).size!==topics.length)issue("SCHEMA_INVALID",`${path}.topic_ids`,p.topic_ids,"1–3 unique topic IDs");
    topics.forEach((t,j)=>{if(typeof t!=="string"||!Object.hasOwn(TOPICS,t))issue("UNKNOWN_TOPIC",`${path}.topic_ids[${j}]`,t,Object.keys(TOPICS));});
    if(typeof p.knowledge_need!=="string"||!p.knowledge_need.trim()||p.knowledge_need.length>499||/必然|必吉|必凶|一定会|注定/.test(p.knowledge_need))issue("SCHEMA_INVALID",`${path}.knowledge_need`,p.knowledge_need,"neutral text, 1–499 characters");
    if(!["task_gap","source_gap","frozen_fact"].includes(String(p.trigger_type)))issue("SCHEMA_INVALID",`${path}.trigger_type`,p.trigger_type,["task_gap","source_gap","frozen_fact"]);
    const anchor=anchors.find(a=>a.anchor_id===p.trigger_ref&&a.parent_task_id===p.parent_task_id&&a.trigger.type===p.trigger_type);
    if(p.trigger_type!=="task_gap"&&!anchor)issue("MISSING_TRIGGER_EVIDENCE",`${path}.trigger_ref`,p.trigger_ref,anchors.filter(a=>a.parent_task_id===p.parent_task_id&&a.trigger.type===p.trigger_type).map(a=>a.anchor_id));
    if(p.trigger_type==="task_gap"&&p.trigger_ref!==undefined)issue("SCHEMA_INVALID",`${path}.trigger_ref`,p.trigger_ref,"omit for task_gap");
    if(parent){
      const allowed=anchor?.topic_ids??parent.topic_ids;
      topics.forEach((t,j)=>{if(typeof t==="string"&&Object.hasOwn(TOPICS,t)&&!allowed.includes(t as TopicId))issue("TOPIC_NOT_ALLOWED",`${path}.topic_ids[${j}]`,t,allowed);});
    }
    if(issues.length!==before||!parent)continue;
    const topicIds=topics as TopicId[], need=p.knowledge_need as string;
    const refs=[...new Set([...parent.fact_refs,...(anchor?.fact_refs??[])])];
    const request:RetrievalRequest={request_id:`r2_${analysisHash([c.plan.plan_hash,i,p]).slice(0,24)}`,parent_task_id:parent.task_id,target_type:"theory",topic_ids:topicIds,semantic_intent:need,keyword_terms:[...new Set(topicIds.flatMap(t=>[TOPICS[t].terms[0],GAP_QUERY_ALIASES[t][0]]))],fact_refs:refs,priority:parent.priority};
    requests.push(request);
    if(anchor){
      extensions.push({extension_id:`EXT_${i+1}`,parent_task_id:parent.task_id,trigger:anchor.trigger,topic_ids:topicIds,fact_refs:anchor.fact_refs,retrieval_question:need.replace(/[?？]+$/,"")+"？",purpose:"resolve_dependency",status:"proposed"});
      if(anchor.trigger.type==="source_gap")gaps.push({gap_id:`G_${i+1}`,trigger:anchor.trigger,description:need});
    }else gaps.push({gap_id:`G_${i+1}`,trigger:{type:"task_gap",task_id:parent.task_id,reason:"insufficient_coverage"},description:need});
  }
  if(raw.decision==="stop"&&requests.length)issue("SCHEMA_INVALID","proposals",raw.proposals,"empty when stop");
  if(raw.decision==="retrieve_more"&&Array.isArray(raw.proposals)&&raw.proposals.length===0)issue("SCHEMA_INVALID","proposals",[],"nonempty when retrieve_more");
  if(issues.length)throw new GapProposalError(issues);
  const result=validateGapAnalysis({decision:raw.decision,gaps,supplemental_tasks:extensions,additional_requests:requests,stop_reason:raw.stop_reason??null},c);
  const accepted=new Set(result.additional_requests.map(r=>r.request_id));
  const signature=(r:RetrievalRequest)=>JSON.stringify([r.target_type,[...new Set(r.keyword_terms)].sort()]);
  const seen=new Set(c.evidence.retrieval_history.flatMap(h=>h.requests).map(signature));
  const dropped:ValidationIssue[]=[];
  for(const [i,r] of requests.entries()){
    const duplicate=seen.has(signature(r));seen.add(signature(r));
    if(!accepted.has(r.request_id))dropped.push({code:duplicate?"DUPLICATE_QUERY":"BUDGET_DEFERRED",path:`proposals[${i}]`,received:r.topic_ids,expected:duplicate?"novel controlled query":"maximum one optional request"});
  }
  return {...result,validation_issues:dropped};
}
