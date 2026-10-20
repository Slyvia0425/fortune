import type { FactCatalog } from "./analysis-facts";
import type { SingleQuestionAnalysis } from "./question-analysis";
import type { LiuyaoCoreFacts } from "../contracts/divination";
import { inspectAnalysisPlan, minimumAnalysisPlan, validateAnalysisPlan, type AnalysisTask } from "./analysis-plan";
import { missingCoverage, PLANNER_MAX_TASKS } from "./planner-contract";
import { normalizePlannerOutput } from "./planner-validation";
export const PLANNER_RECOVERY_VERSION="p1-recovery-v31";

export function recoverPlannerPlan(candidates:unknown[],facts:FactCatalog,question:SingleQuestionAnalysis,questionHash:string,reason:string,core?:LiuyaoCoreFacts){
  const deterministic=minimumAnalysisPlan(facts,question,questionHash,reason,core);
  let best:{plan:typeof deterministic;recovered_task_count:number;generated_task_count:number;recovery_mode:"partial"|"full";dropped_task_ids:string[];source_candidate_index:number|null}={plan:deterministic,recovered_task_count:0,generated_task_count:deterministic.tasks.length,recovery_mode:"full",dropped_task_ids:[],source_candidate_index:null};
  for(const [candidateIndex,candidate] of candidates.entries()){
    const inspected=inspectAnalysisPlan(normalizePlannerOutput(candidate).value,facts,question,core);
    // Whole-task checks include prose, roles, facts and kind contract. Global
    // dependency/duplicate failures cannot be made safe by deleting individual fields.
    const badIds=new Set(inspected.issues.filter(issue=>issue.task_id).map(issue=>issue.task_id));
    let selected=inspected.tasks.filter(task=>!badIds.has(task.task_id));
    const prune=()=>{let changed=true;while(changed){const ids=new Set(selected.map(t=>t.task_id)),next=selected.filter(t=>t.depends_on.every(id=>ids.has(id)));changed=next.length!==selected.length;selected=next;}};
    prune();
    const additions=()=>{
      const gaps=missingCoverage(selected,facts,question);
      return deterministic.tasks.filter(t=>gaps.some(g=>g.required_kind===t.kind));
    };
    // Drop optional/redundant tasks if necessary; never truncate dependencies or
    // rewrite a surviving research goal. Full validation remains the final gate.
    selected.sort((a,b)=>({critical:0,high:1,optional:2}[a.priority]-{critical:0,high:1,optional:2}[b.priority]));
    while(selected.length&&selected.length+additions().length>PLANNER_MAX_TASKS){selected.pop();prune();}
    if(!selected.length)continue;
    const generated=additions().map((task,index):AnalysisTask=>({...task,task_id:`fallback_${task.kind}_${index+1}`}));
    if(generated.some(t=>selected.some(s=>s.task_id===t.task_id)))continue;
    try{
      const plan=validateAnalysisPlan({tasks:[...selected,...generated]},facts,question,questionHash,"fallback",[reason,"PARTIAL_PLAN_RECOVERY"],core);
      if(selected.length>best.recovered_task_count)best={plan,recovered_task_count:selected.length,generated_task_count:generated.length,recovery_mode:"partial",dropped_task_ids:inspected.tasks.filter(t=>!selected.some(s=>s.task_id===t.task_id)).map(t=>t.task_id),source_candidate_index:candidateIndex};
    }catch{/* Conflicting dependencies or global coverage: use the next safe candidate. */}
  }
  return best;
}
