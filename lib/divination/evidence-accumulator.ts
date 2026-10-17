import { createHash } from "node:crypto";
import type { HybridEvidencePack, HybridEvidenceUnit } from "../contracts/divination";
import { analysisHash, canonicalAnalysis, freezeAnalysis } from "./analysis-utils";
import type { RetrievalRequest } from "./query-compiler";
import type { GapRecord } from "./evidence-gap";

export const EVIDENCE_SNAPSHOT_VERSION="evidence-snapshot-v1";
export const quoteHash=(text:string)=>createHash("sha256").update(text).digest("hex");
export interface EvidenceRecord {
  evidence_id:string; source_revision_id:string; source_span_id:string; start_offset:number; end_offset_exclusive:number;
  quote_hash:string; text:string; task_ids:string[]; rounds:number[]; retrieval_request_ids:string[];
  scores_by_request:Record<string,number|null>; shared_source_group?:string; same_text_group?:string;
  kind:"theory"|"case"|"commentary"; candidate_role:"definition"|"condition"|"exception"|"case"|"unknown";
  origins:{source_span_id:string;start:number;end:number;offset_unit:string;entity_revision_id:string;round:number}[];
}
export interface RetrievalTrace {round:1|2;requests:RetrievalRequest[];pack:HybridEvidencePack}
export interface EvidenceSnapshot {
  version:typeof EVIDENCE_SNAPSHOT_VERSION; chart_hash:string; question_hash:string; knowledge_release:string;
  retrieval_identity:Record<string,unknown>; completed_rounds:number; status:"complete"|"partial"|"failed"|"stale";
  evidence:EvidenceRecord[]; unresolved_gaps:GapRecord[]; retrieval_history:RetrievalTrace[];
  stop_reason?:string; errors:string[];
}
const unique=<T>(items:T[])=>[...new Set(items)];
export function emptyEvidenceSnapshot(chartHash:string,questionHash:string,identity:Record<string,unknown>):EvidenceSnapshot{
  if(typeof identity.knowledge_release_id!=="string")throw new Error("EVIDENCE_RELEASE_REQUIRED");
  return {version:EVIDENCE_SNAPSHOT_VERSION,chart_hash:chartHash,question_hash:questionHash,knowledge_release:identity.knowledge_release_id,
    retrieval_identity:identity,completed_rounds:0,status:"partial",evidence:[],unresolved_gaps:[],retrieval_history:[],errors:[]};
}
export function mergeEvidence(previous:EvidenceSnapshot,result:RetrievalTrace):EvidenceSnapshot{
  const next=structuredClone(previous),{pack,requests,round}=result;
  if(round!==previous.completed_rounds+1||round>2||pack.chart_hash!==previous.chart_hash||pack.knowledge_release_id!==previous.knowledge_release
    ||canonicalAnalysis(pack.retrieval_identity)!==canonicalAnalysis(previous.retrieval_identity))throw new Error("EVIDENCE_IDENTITY_MISMATCH");
  const traces=pack.retrieval_trace??[];
  for(const unit of pack.reasoning_evidence??[]){
    if(unit.not_for_interpretation)continue;
    const matches=requests.filter(r=>traces.some(t=>t.request_id===r.request_id&&t.parent_task_id===r.parent_task_id&&t.round===round
      &&Array.isArray(t.selected_evidence_ids)&&t.selected_evidence_ids.includes(unit.entity_revision_id)));
    for(const q of unit.source_quotes){
      if(!q.source_revision_id||!Number.isInteger(q.start)||!Number.isInteger(q.end)||q.start<0||q.end<=q.start||!q.quote||quoteHash(q.quote)!==q.quote_hash
        ||(q.offset_unit&&q.offset_unit!=="unicode_codepoint")||q.end-q.start!==[...q.quote].length)throw new Error("EVIDENCE_QUOTE_INVALID");
      const span=`span_${analysisHash([q.source_revision_id,q.start,q.end])}`;
      const old=next.evidence.find(e=>e.source_revision_id===q.source_revision_id&&(e.quote_hash===q.quote_hash||e.origins.some(o=>o.source_span_id===span)));
      if(old&&old.quote_hash!==q.quote_hash)throw new Error("EVIDENCE_SPAN_CHANGED");
      const record:EvidenceRecord=old??{evidence_id:`ev_${analysisHash([q.source_revision_id,q.start,q.end,q.quote_hash])}`,source_revision_id:q.source_revision_id,source_span_id:span,
        start_offset:q.start,end_offset_exclusive:q.end,quote_hash:q.quote_hash,text:q.quote,task_ids:[],rounds:[],retrieval_request_ids:[],scores_by_request:{},
        kind:unit.kind==="case"?"case":unit.content_type==="author_commentary"?"commentary":"theory",candidate_role:unit.kind==="case"?"case":"unknown",origins:[]};
      record.task_ids=unique([...record.task_ids,...matches.map(r=>r.parent_task_id)]);
      record.rounds=unique([...record.rounds,round]);record.retrieval_request_ids=unique([...record.retrieval_request_ids,...matches.map(r=>r.request_id)]);
      record.origins.push({source_span_id:span,start:q.start,end:q.end,offset_unit:q.offset_unit??"unicode_codepoint",entity_revision_id:unit.entity_revision_id,round});
      for(const r of matches){
        const t=traces.find(t=>t.request_id===r.request_id&&t.round===round);
        const hits=Array.isArray(t?.keyword_top)?t.keyword_top as {entity_revision_id:string;score:number}[]:[];
        const vector=Array.isArray(t?.vector_top)?t.vector_top as {entity_revision_id:string;similarity:number}[]:[];
        record.scores_by_request[r.request_id]=hits.find(h=>h.entity_revision_id===unit.entity_revision_id)?.score??vector.find(h=>h.entity_revision_id===unit.entity_revision_id)?.similarity??null;
      }
      if(!old)next.evidence.push(record);
    }
  }
  // Connected overlap groups retain BOTH semantic units; they are not independent support.
  const groups=next.evidence.map((_,i)=>i);
  const root=(i:number):number=>groups[i]===i?i:(groups[i]=root(groups[i]));
  for(let i=0;i<next.evidence.length;i++)for(let j=0;j<i;j++){
    const a=next.evidence[i],b=next.evidence[j];
    if(a.source_revision_id===b.source_revision_id&&a.origins.some(x=>b.origins.some(y=>Math.max(x.start,y.start)<Math.min(x.end,y.end))))groups[root(i)]=root(j);
  }
  next.evidence.forEach((e,i)=>{
    const members=next.evidence.filter((_,j)=>root(j)===root(i));
    if(members.length>1)e.shared_source_group=`shared_${analysisHash(members.map(x=>x.evidence_id).sort())}`;
    if(next.evidence.some(other=>other!==e&&other.quote_hash===e.quote_hash))e.same_text_group=`text_${e.quote_hash}`;
  });
  next.completed_rounds=round;next.retrieval_history.push(structuredClone(result));
  return freezeAnalysis(next);
}
// Temporary adapter for the pre-PR-6 writer: union both rounds, NEVER last-round wins.
export function accumulatedEvidencePack(snapshot:EvidenceSnapshot):HybridEvidencePack|null{
  if(snapshot.status==="stale")return null;
  const first=snapshot.retrieval_history[0]?.pack;if(!first)return null;
  const units=new Map<string,HybridEvidenceUnit>();
  for(const h of snapshot.retrieval_history)for(const unit of h.pack.reasoning_evidence??[])if(!units.has(unit.entity_revision_id))units.set(unit.entity_revision_id,unit);
  const evidence=[...units.values()];
  return {...first,reasoning_evidence:evidence,pending_conditions:evidence,retrieval_trace:snapshot.retrieval_history.flatMap(h=>h.pack.retrieval_trace??[]),
    gaps:unique([...snapshot.retrieval_history.flatMap(h=>h.pack.gaps),...snapshot.unresolved_gaps.map(g=>g.gap_id)]),
    interpretation_contract:{...first.interpretation_contract,strong_conclusion_allowed:false},status:"evidence_insufficient"};
}
