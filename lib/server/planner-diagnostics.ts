import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PlannerValidationIssue } from "../divination/planner-validation";
import type { PlannerCallMetadata } from "./divination-llm";
import { redactTrace } from "./case-trace";

export interface PlannerAttempt {
  attempt:number;raw_output:string|null;previous_plan?:unknown;validation_issues:PlannerValidationIssue[];
  outcome:"accepted"|"rejected";elapsed_ms:number;normalizations:string[];metadata:PlannerCallMetadata;
}
export interface PlannerDiagnostic {
  run_id:string;created_at:string;chart_hash:string;question_hash:string;attempts:PlannerAttempt[];
  fallback_reason?:string;recovered_task_count?:number;generated_task_count?:number;
  recovery_mode?:"partial"|"full";
  original_validation_issues?:PlannerValidationIssue[];final_tasks?:unknown;failure?:string;
}
export async function savePlannerDiagnostics(run:PlannerDiagnostic,root=join(process.cwd(),".runtime","planner-diagnostics")){
  if(!/^[a-f0-9-]{36}$/.test(run.run_id))throw new Error("PLANNER_DIAGNOSTIC_ID_INVALID");
  await mkdir(root,{recursive:true,mode:0o700});
  await writeFile(join(root,`${run.run_id}-${randomUUID()}.json`),JSON.stringify(redactTrace(run),null,2),{mode:0o600,flag:"wx"});
}
