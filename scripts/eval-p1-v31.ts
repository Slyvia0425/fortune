import { loadEnvFile } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import type { PlannerDiagnostic } from "../lib/server/planner-diagnostics";
import type { SingleQuestionAnalysis } from "../lib/divination/question-analysis";
import type { UseRoleAnalysis, LiuyaoCoreFacts } from "../lib/contracts/divination";
import type { FactCatalog } from "../lib/divination/analysis-facts";

loadEnvFile(".env.local");
const {planAnalysisTasks,P1_PROMPT}=await import("../lib/server/analysis-planner-llm");
const {buildPlannerInput}=await import("../lib/divination/planner-input");
const {analysisHash}=await import("../lib/divination/analysis-utils");
const {missingCoverage}=await import("../lib/divination/planner-contract");
const {inspectAnalysisPlan,validateAnalysisPlan}=await import("../lib/divination/analysis-plan");
const {savePlannerDiagnostics}=await import("../lib/server/planner-diagnostics");
const {traceRoute}=await import("../lib/server/case-trace");
const {withWorkflowDeadline}=await import("../lib/server/workflow-budget");
const {analysisModelIdentity}=await import("../lib/server/divination-llm");
const history=JSON.parse(await readFile("tests/fixtures/p1-v31-history.json","utf8"));
const count=10,root=resolve(`.runtime/evals/p1-v31-${Date.now()}`);
await mkdir(root,{recursive:true,mode:0o700});
const save=(name:string,value:unknown)=>writeFile(join(root,name),JSON.stringify(value,null,2),{mode:0o600});
const question=history.input.question_analysis as SingleQuestionAnalysis,roles=history.input.validated_use_roles as UseRoleAnalysis;
const facts=history.input.fact_catalog as FactCatalog,core=history.core as LiuyaoCoreFacts;
const immutable=analysisHash([question,roles,facts,core]);
const codeFiles=["lib/server/analysis-planner-llm.ts","lib/server/planner-diagnostics.ts","lib/server/divination-llm.ts","lib/server/workflow-budget.ts","lib/divination/analysis-plan.ts","lib/divination/planner-contract.ts","lib/divination/planner-input.ts","lib/divination/planner-validation.ts","lib/divination/planner-description.ts","lib/divination/planner-recovery.ts","lib/divination/fact-claim-guard.ts","lib/divination/topic-taxonomy.ts","tests/fixtures/p1-v31-history.json"];
const codeManifest=async()=>Object.fromEntries(await Promise.all(codeFiles.map(async path=>[path,analysisHash(await readFile(path,"utf8"))])));
const originalDirectory=resolve(".runtime/evals/job-entry-245-1792072175332");
const sourceManifest=async()=>Object.fromEntries(await Promise.all(["cast.json","confirmation.json","interpretation.json"].map(async name=>[name,analysisHash(await readFile(join(originalDirectory,name),"utf8"))])));
const codeBefore=await codeManifest(),sourceBefore=await sourceManifest();
await save("code-manifest.json",codeBefore);await save("source-manifest.json",sourceBefore);
await save("input.json",buildPlannerInput(question,roles,facts,{core}));await save("prompt.json",{system:P1_PROMPT});
await save("deterministic-fallback.json",(await import("../lib/divination/analysis-plan")).minimumAnalysisPlan(facts,question,history.confirmed_question.question_hash,"acceptance_example",core));
const recovery=(await import("../lib/divination/planner-recovery")).recoverPlannerPlan(history.attempts.map((a:{raw_output:string})=>JSON.parse(a.raw_output)),facts,question,history.confirmed_question.question_hash,"historical_replay",core);
await save("historical-recovery.json",{original_attempts:history.attempts,recovery,field_comparison:recovery.plan.tasks.map(task=>{
  const original=recovery.source_candidate_index===null?null:JSON.parse(history.attempts[recovery.source_candidate_index].raw_output).tasks.find((t:{task_id:string})=>t.task_id===task.task_id);
  return {task_id:task.task_id,original:original??null,final:task,changed_fields:original?Object.keys(task).filter(key=>analysisHash(original[key])!==analysisHash(task[key as keyof typeof task])):Object.keys(task),change_kind:original?"retained_whole_task":"generated_from_verified_facts"};
})});
console.log(JSON.stringify({event:"start",directory:root,chart_id:history.chart_id,model:analysisModelIdentity(),independent_p1_runs:count,no_recast:true}));
const runs:Record<string,unknown>[]=[];
for(let index=1;index<=count;index++){
  const started=Date.now();let audit:PlannerDiagnostic|undefined;
  const response=await traceRoute("p1-v31-evaluation",new Request("http://local/p1-eval",{method:"POST",body:JSON.stringify({chart_id:history.chart_id,run:index})}),async()=>{
    const plan=await withWorkflowDeadline(()=>planAnalysisTasks(question,roles,facts,history.confirmed_question.question_hash,undefined,{core},{save:async value=>{audit=value;await savePlannerDiagnostics(value);}}),Date.now()+420_000);
    validateAnalysisPlan({tasks:plan.tasks},facts,question,history.confirmed_question.question_hash,"generated",[],core);
    return Response.json({plan});
  });
  const {plan}=await response.json();
  assert.ok(audit,"private diagnostics must be saved");
  const attempt=audit.attempts[0];let initialCoverage=false;
  try{initialCoverage=missingCoverage(inspectAnalysisPlan(JSON.parse(attempt.raw_output!),facts,question,core).tasks,facts,question).length===0;}catch{/* invalid initial JSON */}
  const usageMissing=audit.attempts.filter(a=>a.metadata.input_tokens===undefined||a.metadata.output_tokens===undefined).length;
  const reportedInput=audit.attempts.reduce((n,a)=>n+(a.metadata.input_tokens??0),0),reportedOutput=audit.attempts.reduce((n,a)=>n+(a.metadata.output_tokens??0),0);
  const row={run:index,trace_id:response.headers.get("X-Divination-Trace-Id"),trace_status:response.headers.get("X-Divination-Trace-Status"),status:plan.status,elapsed_ms:Date.now()-started,
    first_pass_valid:attempt?.outcome==="accepted",repair_attempted:audit.attempts.length===2,repair_succeeded:audit.attempts.length===2&&audit.attempts[1].outcome==="accepted",
    first_coverage_valid:initialCoverage,final_coverage_valid:missingCoverage(plan.tasks,facts,question).length===0,
    task_count:plan.tasks.length,input_tokens:usageMissing?null:reportedInput,output_tokens:usageMissing?null:reportedOutput,
    reported_input_tokens:reportedInput,reported_output_tokens:reportedOutput,usage_missing_attempts:usageMissing,
    unsupported_assumption_attempts:audit.attempts.filter(a=>a.validation_issues.some(i=>i.code==="PLAN_UNSUPPORTED_ASSUMPTION")).length,
    direction_or_role_violation_attempts:audit.attempts.filter(a=>a.validation_issues.some(i=>/USE_ROLE_CHANGED|RELATION_DIRECTION_INVALID/.test(i.code))).length,
    fallback_reason:audit.fallback_reason,recovered_task_count:audit.recovered_task_count,generated_task_count:audit.generated_task_count,
    task_relevance:"pending_manual_review; constraints alone do not prove professional relevance"};
  await save(`run-${index}.json`,{...row,plan,diagnostic:audit});runs.push(row);
  assert.equal(analysisHash([question,roles,facts,core]),immutable,"Frozen input mutated");
  assert.deepEqual(await sourceManifest(),sourceBefore,"Historical source changed");assert.deepEqual(await codeManifest(),codeBefore,"Code changed during fixed-version evaluation");
  const latencies=runs.map(r=>Number(r.elapsed_ms)).sort((a,b)=>a-b),repairs=runs.filter(r=>r.repair_attempted);
  const summary={chart_id:history.chart_id,chart_hash:history.chart_hash,model:analysisModelIdentity(),no_recast:true,frozen_unchanged:true,completed_runs:runs.length,
    first_pass_valid_rate:runs.filter(r=>r.first_pass_valid).length/runs.length,repair_success_rate:repairs.length?repairs.filter(r=>r.repair_succeeded).length/repairs.length:null,
    fallback_rate:runs.filter(r=>r.status==="fallback").length/runs.length,first_coverage_pass_rate:runs.filter(r=>r.first_coverage_valid).length/runs.length,
    final_coverage_pass_rate:runs.filter(r=>r.final_coverage_valid).length/runs.length,p95_ms:latencies[Math.ceil(.95*latencies.length)-1],p95_method:"nearest rank; all runs",
    reported_input_tokens:runs.reduce((n,r)=>n+Number(r.reported_input_tokens),0),reported_output_tokens:runs.reduce((n,r)=>n+Number(r.reported_output_tokens),0),usage_missing_attempts:runs.reduce((n,r)=>n+Number(r.usage_missing_attempts),0),manual_review_status:"pending",
    source_manifest_hash:analysisHash(sourceBefore),code_manifest_hash:analysisHash(codeBefore),multidomain_real_frozen_acceptance:"not_met: only 3 structured confirmed job charts available; separate synthetic structural regressions are not substitutes",runs};
  await save("summary.json",summary);console.log(JSON.stringify({event:"run",...row}));
}
console.log(JSON.stringify({event:"finished",directory:root}));
