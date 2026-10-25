import { createHash } from "node:crypto";
import type { QuestionContext } from "../contracts/divination";
import { EVENT_TAXONOMY, QUESTION_TAXONOMY_VERSION, QUESTION_TYPES, type QuestionDomain, type QuestionType } from "./topic-taxonomy";
import { hasExplicitMultipleIssues } from "./chat-gate";

export const QUESTION_ANALYSIS_VERSION = "single-question-analysis-v4";
export const QUESTION_ANALYSIS_PROMPT_VERSION = "q1-precheck-v2-literal-context";
export type QuestionAnalysisStatus = "valid" | "semantic_conflict" | "extraction_failed" | "unsupported";
export interface QuestionSource { source_id:string; text:string }
export interface SemanticEvidence { source_id:string; start:number; end:number; text:string }
export interface SingleQuestionAnalysis {
  version:typeof QUESTION_ANALYSIS_VERSION; taxonomy_version:string; prompt_version:string;
  status:QuestionAnalysisStatus; issue_count:number; issues:string[];
  normalized_question:string; domain:QuestionDomain; event_type:string; raw_event_description:string;
  question_type:QuestionType; subject_actor_id:string|null;
  actors:Array<{id:string; label:string; role:"querent"|"target"|"third_party"; evidence:SemanticEvidence}>;
  relationships:Array<{from:string; to:string; relation:string; evidence:SemanticEvidence}>;
  current_state:string|null; current_state_evidence:SemanticEvidence|null;
  target_state:string|null; target_state_evidence:SemanticEvidence|null;
  time_constraint:{kind:"duration"|"calendar"|"point"|"present"; expression:string; evidence:SemanticEvidence}|null;
  explicit_context:Array<{text:string; evidence:SemanticEvidence}>;
}

export function questionSources(context:QuestionContext):QuestionSource[]{
  const sources:QuestionSource[]=[{source_id:"question",text:context.raw_question}];
  for(const key of ["initiator", "perspective_person", "process_stage", "time_expression"] as const){
    const f=context[key];if(f?.evidence&&f.provenance!=="model_inference")sources.push({source_id:`context:${key}`,text:f.evidence.text});
  }
  context.known_facts.forEach((f,i)=>{if(f.evidence&&f.provenance!=="model_inference")sources.push({source_id:`context:fact:${i}`,text:f.evidence.text});});
  context.target_entities.forEach((e,i)=>{if(e.evidence&&e.provenance!=="model_inference")sources.push({source_id:`context:actor:${i}`,text:e.evidence.text});});
  context.relationships.forEach((r,i)=>{if(r.evidence&&r.provenance!=="model_inference")sources.push({source_id:`context:relation:${i}`,text:r.evidence.text});});
  return sources;
}
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("QUESTION_SCHEMA_INVALID");return value as Record<string,unknown>;
}
function text(value:unknown,max=500):string{
  if(typeof value!=="string"||!value.trim()||value.length>max)throw new Error("QUESTION_SCHEMA_INVALID");return value;
}
function array(value:unknown,max=16):unknown[]{if(!Array.isArray(value)||value.length>max)throw new Error("QUESTION_SCHEMA_INVALID");return value;}
function evidence(value:unknown,sources:QuestionSource[]):SemanticEvidence{
  const e=object(value),source=sources.find(s=>s.source_id===e.source_id);
  const quote=text(e.text);
  if(!source)throw new Error("QUESTION_SOURCE_INVALID");
  if(!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.end)||Number(e.start)<0||Number(e.end)<=Number(e.start)||Number(e.end)>source.text.length
    ||source.text.slice(Number(e.start),Number(e.end))!==quote){
    const unique=source.text.indexOf(quote);
    if(unique<0||source.text.lastIndexOf(quote)!==unique)throw new Error("QUESTION_SOURCE_INVALID");
    return {source_id:source.source_id,start:unique,end:unique+quote.length,text:quote};
  }
  return {source_id:source.source_id,start:Number(e.start),end:Number(e.end),text:String(e.text)};
}
function literalEvidence(label:string,sources:QuestionSource[]):SemanticEvidence{
  const question=sources.find(s=>s.source_id==="question")!;
  const start=question.text.indexOf(label);
  if(start>=0&&question.text.lastIndexOf(label)===start)return {source_id:"question",start,end:start+label.length,text:label};
  if(start>=0)throw new Error("QUESTION_SOURCE_AMBIGUOUS");
  const exact=sources.filter(s=>s.source_id.startsWith("context:")&&s.text===label);
  if(exact.length!==1)throw new Error("QUESTION_SOURCE_INVALID");
  return {source_id:exact[0].source_id,start:0,end:label.length,text:label};
}
export function failedQuestionAnalysis(context:QuestionContext,code:string):SingleQuestionAnalysis{
  return {version:QUESTION_ANALYSIS_VERSION,taxonomy_version:QUESTION_TAXONOMY_VERSION,prompt_version:QUESTION_ANALYSIS_PROMPT_VERSION,
    status:"extraction_failed",issue_count:0,issues:[code],normalized_question:context.raw_question,domain:"other",event_type:"other",raw_event_description:context.raw_question,
    question_type:"unknown",subject_actor_id:null,actors:[],relationships:[],current_state:null,current_state_evidence:null,target_state:null,target_state_evidence:null,time_constraint:null,explicit_context:[]};
}

export function validateQuestionAnalysis(value:unknown,context:QuestionContext):SingleQuestionAnalysis{
  const raw=object(value);
  // Absent optional semantics become unknown, never invented facts. The
  // mandatory status, issue count, question text, and functional type stay strict.
  const v:Record<string,unknown>={actors:[],relationships:[],subject_actor_id:null,current_state:null,current_state_evidence:null,
    target_state:null,target_state_evidence:null,time_constraint:null,explicit_context:[],issues:[],...raw},sources=questionSources(context);
  if(v.normalized_question!==context.raw_question)throw new Error("QUESTION_CHANGED");
  if(!["valid","semantic_conflict","unsupported"].includes(String(v.status))||!Number.isSafeInteger(v.issue_count)||Number(v.issue_count)<0||Number(v.issue_count)>8)throw new Error("QUESTION_SCHEMA_INVALID");
  const issues=array(v.issues,8).map(i=>text(i,160));
  const issueCount=Math.max(Number(v.issue_count),context.goal_groups.length>1?context.goal_groups.length:0,hasExplicitMultipleIssues(context.raw_question)?2:0);
  const status:QuestionAnalysisStatus=issueCount>1?"semantic_conflict":v.status as QuestionAnalysisStatus;
  if(status==="semantic_conflict")return {...failedQuestionAnalysis(context,"SEMANTIC_CONFLICT"),status,issue_count:issueCount,issues:issues.length?issues:["MULTIPLE_OR_AMBIGUOUS_ISSUES"]};
  if(status==="valid"&&(v.issue_count!==1||context.ambiguities.length))throw new Error("QUESTION_SINGLE_ISSUE_INVALID");
  const domain=(typeof v.domain==="string"&&Object.hasOwn(EVENT_TAXONOMY,v.domain)?v.domain:"other") as QuestionDomain;
  const events:readonly string[]=EVENT_TAXONOMY[domain];
  const event_type=events.includes(String(v.event_type))?String(v.event_type):"other";
  if(!QUESTION_TYPES.includes(v.question_type as QuestionType))throw new Error("QUESTION_TYPE_INVALID");
  const rawDescription=context.raw_question; // authoritative original description, not an LLM caption
  // New terms stay other rather than becoming a fabricated supported event.
  const effectiveStatus=status==="unsupported"?"valid":status;
  if(effectiveStatus==="valid"&&v.issue_count!==1)throw new Error("QUESTION_SINGLE_ISSUE_INVALID");
  const map=new Map<string,string>();
  const actors=array(v.actors).map(item=>{
    const a=object(item),id=text(a.id,64),label=text(a.label,120),ev=a.evidence===undefined?literalEvidence(label,sources):evidence(a.evidence,sources);
    if(map.has(id)||label!==ev.text||!["querent","target","third_party"].includes(String(a.role)))throw new Error("QUESTION_ACTOR_INVALID");
    const stable="actor_"+createHash("sha256").update(JSON.stringify([label,a.role,ev])).digest("hex").slice(0,16);
    map.set(id,stable);return {id:stable,label,role:a.role as "querent"|"target"|"third_party",evidence:ev};
  });
  // Resolve the confirmed perspective endpoint only from a unique literal self reference.
  // This repairs IDs, not relationship meaning; the edge still must match D1 below.
  if(context.relationships.some(r=>r.from_entity_id==="perspective")&&!actors.some(a=>a.role==="querent")){
    const label=context.perspective_person?.evidence?.text??(context.raw_question.match(/我/g)?.length===1?"我":null);
    if(label){
      const ev=literalEvidence(label,sources),id="actor_"+createHash("sha256").update(JSON.stringify([label,"querent",ev])).digest("hex").slice(0,16);
      actors.push({id,label,role:"querent",evidence:ev});
    }
  }
  if(new Set(actors.map(a=>a.id)).size!==actors.length)throw new Error("QUESTION_ACTOR_DUPLICATE");
  const modelRelationships=array(v.relationships);
  if(!context.relationships.length&&modelRelationships.length)issues.push("UNCONFIRMED_RELATION_DISCARDED");
  const relationships=(context.relationships.length?modelRelationships:[]).map(item=>{
    const r=object(item),ev=evidence(r.evidence,sources),relation=text(r.relation,100);
    let from=map.get(String(r.from)),to=map.get(String(r.to));
    const confirmed=context.relationships.filter(c=>c.relation===relation&&c.evidence?.text===ev.text);
    if(confirmed.length===1){
      const c=confirmed[0];
      const endpoint=(entityId:string)=>actors.filter(a=>entityId==="perspective"?a.role==="querent":a.label===context.target_entities.find(e=>e.entity_id===entityId)?.label);
      const starts=endpoint(c.from_entity_id),ends=endpoint(c.to_entity_id);
      if(starts.length===1&&ends.length===1){from=starts[0].id;to=ends[0].id;}
    }
    const fromActor=actors.find(a=>a.id===from),toActor=actors.find(a=>a.id===to);
    const matches=context.relationships.some(c=>{
      const fromLabel=context.target_entities.find(e=>e.entity_id===c.from_entity_id)?.label;
      const toLabel=context.target_entities.find(e=>e.entity_id===c.to_entity_id)?.label;
      return c.relation===relation&&c.evidence?.text===ev.text&&toLabel===toActor?.label
        &&(c.from_entity_id==="perspective"?fromActor?.role==="querent":fromLabel===fromActor?.label);
    });
    if(!from||!to||from===to||!matches)throw new Error("QUESTION_RELATION_INVALID");
    return {from,to,relation,evidence:ev};
  });
  const state=(key:"current_state"|"target_state")=>{
    if(v[key]===null){if(v[`${key}_evidence`]!==null)throw new Error("QUESTION_STATE_INVALID");return {value:null,evidence:null};}
    const ev=evidence(v[`${key}_evidence`],sources);
    text(v[key],160);
    if(key==="current_state"&&!/^context:(?:fact:\d+|process_stage)$/.test(ev.source_id))throw new Error("QUESTION_STATE_NEEDS_EXPLICIT_CONTEXT");
    // State descriptions use the cited literal, never a model's paraphrase or
    // extra conclusion. This normalization cannot add a new real-world fact.
    return {value:ev.text,evidence:ev};
  };
  const current=state("current_state"),target=state("target_state");
  let time:SingleQuestionAnalysis["time_constraint"]=null;
  if(v.time_constraint!==null){
    const t=object(v.time_constraint),ev=evidence(t.evidence,sources),expression=text(t.expression,160);
    if(!["duration","calendar","point","present"].includes(String(t.kind))||expression!==ev.text)throw new Error("QUESTION_TIME_INVALID");
    if(/今年|明年|本月|年底/.test(expression)&&t.kind!=="calendar")throw new Error("QUESTION_CALENDAR_INVALID");
    time={kind:t.kind as NonNullable<SingleQuestionAnalysis["time_constraint"]>["kind"],expression,evidence:ev};
  }
  const explicit_context=array(v.explicit_context).map(item=>{
    const c=object(item),ev=evidence(c.evidence??c,sources),description=text(c.text);
    if(ev.source_id==="question"||description!==ev.text)throw new Error("QUESTION_CONTEXT_INVALID");return {text:description,evidence:ev};
  });
  const subject=v.subject_actor_id===null?null:map.get(String(v.subject_actor_id));
  if(subject===undefined)throw new Error("QUESTION_SUBJECT_INVALID");
  if(effectiveStatus==="valid"&&event_type==="hiring_other"&&(!subject||!actors.some(a=>a.id===subject&&a.role==="target")))throw new Error("QUESTION_HIRING_SUBJECT_INVALID");
  return {version:QUESTION_ANALYSIS_VERSION,taxonomy_version:QUESTION_TAXONOMY_VERSION,prompt_version:QUESTION_ANALYSIS_PROMPT_VERSION,
    status:effectiveStatus,issue_count:issueCount,issues,normalized_question:context.raw_question,domain,event_type,raw_event_description:rawDescription,
    question_type:v.question_type as QuestionType,subject_actor_id:subject,actors,relationships,current_state:current.value,current_state_evidence:current.evidence,
    target_state:target.value,target_state_evidence:target.evidence,time_constraint:time,explicit_context};
}
