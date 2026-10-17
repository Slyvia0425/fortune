import { analysisHash, canonicalAnalysis, freezeAnalysis } from "./analysis-utils";
import { emptyEvidenceSnapshot, mergeEvidence, accumulatedEvidencePack, type EvidenceSnapshot } from "./evidence-accumulator";
import { machineGaps, type GapAnalysis, type GapContext, type SupplementalTask } from "./evidence-gap";
import type { CompiledRetrievalPlan, RetrievalRequest } from "./query-compiler";
import type { HybridEvidencePack } from "../contracts/divination";

export const AGENT_CONTROLLER_VERSION="bounded-agent-pr5-v1";
export interface AgentResult {version:typeof AGENT_CONTROLLER_VERSION;snapshot:EvidenceSnapshot;supplemental_tasks:SupplementalTask[];gap_analysis?:GapAnalysis;stop_reason:string;terminal:boolean;fingerprint:string}
export interface AgentInput extends Omit<GapContext,"evidence"> {chart_id:string;question_hash:string;identity:Record<string,unknown>;compiled:CompiledRetrievalPlan;fingerprint:string;deadlineAt:number;retryIncomplete?:boolean;minReservedTailMs?:number}
export interface AgentDependencies {
  now:()=>number;retrieve:(compiled:CompiledRetrievalPlan)=>Promise<HybridEvidencePack>;
  analyze:(context:GapContext)=>Promise<GapAnalysis>;
  save:(state:AgentResult)=>Promise<void>;load:()=>Promise<AgentResult|null>;
}
const errorCode=(error:unknown)=>error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:"RETRIEVAL_FAILED";
export function validateAgentCheckpoint(state:AgentResult,input:AgentInput):AgentResult{
  if(state.version!==AGENT_CONTROLLER_VERSION||state.fingerprint!==input.fingerprint||state.snapshot.chart_hash!==input.plan.chart_hash||state.snapshot.question_hash!==input.question_hash
    ||canonicalAnalysis(state.snapshot.retrieval_identity)!==canonicalAnalysis(input.identity)||state.snapshot.completed_rounds<0||state.snapshot.completed_rounds>2)throw new Error("AGENT_CHECKPOINT_INVALID");
  let replay=emptyEvidenceSnapshot(input.plan.chart_hash,input.question_hash,input.identity);
  for(const round of state.snapshot.retrieval_history)replay=mergeEvidence(replay,round);
  if(canonicalAnalysis(replay.evidence)!==canonicalAnalysis(state.snapshot.evidence)||replay.completed_rounds!==state.snapshot.completed_rounds)throw new Error("AGENT_CHECKPOINT_EVIDENCE_INVALID");
  return freezeAnalysis(state);
}
export async function runEvidenceAgent(input:AgentInput,deps:AgentDependencies):Promise<AgentResult>{
  let state:AgentResult={version:AGENT_CONTROLLER_VERSION,snapshot:emptyEvidenceSnapshot(input.plan.chart_hash,input.question_hash,input.identity),supplemental_tasks:[],stop_reason:"INITIAL",terminal:false,fingerprint:input.fingerprint};
  const context=():GapContext=>({plan:input.plan,facts:input.facts,question:input.question,evidence:state.snapshot});
  const remaining=()=>input.deadlineAt-deps.now();
  const reserve=input.minReservedTailMs??50_000;
  const commit=async(reason:string,terminal:boolean)=>{
    state={...state,stop_reason:reason,terminal,snapshot:{...state.snapshot,stop_reason:reason}};
    // Local durable persistence is allowed even at deadline; no new network calls.
    await deps.save(state);return freezeAnalysis(structuredClone(state));
  };
  const old=await deps.load();if(old){
    state=structuredClone(validateAgentCheckpoint(old,input));
    if(state.terminal&&state.snapshot.completed_rounds>0){
      const recoverable=state.stop_reason==="ROUND2_FAILED"||state.stop_reason==="INSUFFICIENT_TAIL_BUDGET"||state.stop_reason.startsWith("GAP_FAILED")||state.stop_reason==="GAP_BUDGET_EXHAUSTED";
      if(!input.retryIncomplete||state.snapshot.completed_rounds!==1||state.snapshot.status==="stale"||!recoverable)return state;
      // Explicit user retry is a new bounded run, reusing Round 1, never a third round.
      state.terminal=false;if(!state.gap_analysis?.compiled)state.gap_analysis=undefined;
    }
  }
  if(remaining()<=0)return commit("GLOBAL_DEADLINE",true);
  if(state.snapshot.completed_rounds===0){
    try{
      const pack=await deps.retrieve(input.compiled);if(pack.chart_id!==input.chart_id)throw new Error("EVIDENCE_CHART_MISMATCH");
      const executed=new Set(input.compiled.queries.map(q=>q.request_id));
      state.snapshot=mergeEvidence(state.snapshot,{round:1,requests:input.compiled.requests.filter(r=>executed.has(r.request_id)),pack});
      state.snapshot={...state.snapshot,unresolved_gaps:machineGaps(context())};
      await commit("ROUND1_SAVED",false);
    }catch(error){state.snapshot={...state.snapshot,status:"failed",errors:[...state.snapshot.errors,errorCode(error)]};return commit("ROUND1_FAILED",true);}
  }
  if(remaining()<reserve)return commit("INSUFFICIENT_TAIL_BUDGET",true);
  let analysis:GapAnalysis;
  try{analysis=state.gap_analysis??await deps.analyze(context());}catch(error){state.snapshot={...state.snapshot,errors:[...state.snapshot.errors,errorCode(error)]};return commit("GAP_FAILED",true);}
  state.gap_analysis=analysis;state.supplemental_tasks=analysis.supplemental_tasks;
  const gaps=[...state.snapshot.unresolved_gaps,...analysis.gaps];
  state.snapshot={...state.snapshot,unresolved_gaps:[...new Map(gaps.map(g=>[analysisHash(g.trigger),g])).values()]};
  const important=analysis.gaps.some(g=>input.plan.tasks.some(t=>t.task_id===g.trigger.task_id&&t.priority!=="optional"))
    ||analysis.supplemental_tasks.some(s=>s.status==="approved"&&input.plan.tasks.some(t=>t.task_id===s.parent_task_id&&t.priority!=="optional"));
  if(analysis.decision!=="retrieve_more"||!analysis.compiled||analysis.compiled.round!==2||analysis.compiled.queries.length>3||state.snapshot.completed_rounds!==1||!important||remaining()<reserve){
    state.snapshot={...state.snapshot,status:state.snapshot.unresolved_gaps.length||analysis.stop_reason?.startsWith("GAP_FAILED")?"partial":"complete"};
    return commit(remaining()<reserve?"INSUFFICIENT_TAIL_BUDGET":analysis.stop_reason??"NO_IMPORTANT_NOVEL_REQUESTS",true);
  }
  // Save approved intentions before Round 2: process failure cannot erase Round 1.
  await commit("ROUND2_APPROVED",false);
  try{
    if(remaining()<reserve)return commit("INSUFFICIENT_TAIL_BUDGET",true);
    const pack=await deps.retrieve(analysis.compiled);if(pack.chart_id!==input.chart_id)throw new Error("EVIDENCE_CHART_MISMATCH");
    const executed=new Set(analysis.compiled.queries.map(q=>q.request_id));
    state.snapshot=mergeEvidence(state.snapshot,{round:2,requests:analysis.additional_requests.filter(r=>executed.has(r.request_id)),pack});
    state.snapshot={...state.snapshot,status:state.snapshot.unresolved_gaps.length?"partial":"complete"};
    return commit("ROUND_LIMIT",true);
  }catch(error){
    const stale=Boolean(error&&typeof error==="object"&&"status" in error&&error.status===409)||errorCode(error)==="EVIDENCE_IDENTITY_MISMATCH";
    state.snapshot={...state.snapshot,status:stale?"stale":"partial",errors:[...state.snapshot.errors,errorCode(error)]};
    return commit(stale?"RETRIEVAL_IDENTITY_CHANGED":"ROUND2_FAILED",true);
  }
}
export { accumulatedEvidencePack };
export type { RetrievalRequest };
