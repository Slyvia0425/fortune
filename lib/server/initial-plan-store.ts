import type { FrozenQuestionRecord } from "../contracts/divination";
import { callHybrid } from "./liuyao-hybrid";
import { traceNode } from "./case-trace";
import { buildInitialAnalysisPlan, plannerCheckpointKey, validatePlannerCheckpoint, type InitialPlannerSnapshot, type BlockedPlannerResult } from "./analysis-planner";

const jobs=new Map<string,Promise<InitialPlannerSnapshot|BlockedPlannerResult>>();
// Both endpoints first load the owner-scoped frozen record. Only immutable,
// validated ready snapshots are committed; retries never re-run R1/P1.
export async function loadInitialAnalysisPlan(saved:FrozenQuestionRecord){
  return traceNode("planner-checkpoint",{chart_id:saved.cast.chart_id,chart_hash:saved.cast.chart_hash,confirmation_id:saved.confirmed_question?.confirmation_id},()=>loadInitialAnalysisPlanImpl(saved));
}
async function loadInitialAnalysisPlanImpl(saved:FrozenQuestionRecord){
  const key=plannerCheckpointKey(saved),active=jobs.get(key);
  if(active)return traceNode("planner-inflight-hit",{checkpoint_key:key},()=>active);
  const work=(async()=>{
    const input={chart_id:saved.cast.chart_id,checkpoint_key:key};
    const cached=await callHybrid<{plan:InitialPlannerSnapshot|null}>("analysis-plan",input,true);
    if(cached.plan)return traceNode("planner-cache-hit",{checkpoint_key:key},()=>validatePlannerCheckpoint(cached.plan!,saved));
    const result=await buildInitialAnalysisPlan(saved);
    if(result.status!=="ready")return result;
    const committed=await callHybrid<{plan:InitialPlannerSnapshot}>("analysis-plan",{...input,plan:result},true);
    return validatePlannerCheckpoint(committed.plan,saved);
  })();
  jobs.set(key,work);
  try{return await work;}finally{jobs.delete(key);}
}
