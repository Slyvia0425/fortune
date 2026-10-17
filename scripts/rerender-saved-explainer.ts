// No model, retrieval, cast or confirmation calls. Safely presents a saved real
// model partial with the current renderer, explicitly labelled as a rerender.
import {loadEnvFile} from "node:process";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import assert from "node:assert/strict";
import type {FrozenQuestionRecord} from "../lib/contracts/divination";
import type {ReasoningContext} from "../lib/divination/structured-reasoning";
loadEnvFile(".env.local");
const {analysisHash}=await import("../lib/divination/analysis-utils");
const {validateReasoningContext,validatePartialStructuredReasoning}=await import("../lib/divination/structured-reasoning");
const {runReasoningStage}=await import("../lib/server/reasoning-stage");
const {traceRoute}=await import("../lib/server/case-trace");
const frozenDir=resolve(process.argv[2]),source=resolve(process.argv[3]);
const read=async(dir:string,name:string)=>JSON.parse(await readFile(join(dir,name),"utf8"));
const [cast,confirmation,dialogue,payload]=await Promise.all([read(frozenDir,"cast.json"),read(frozenDir,"confirmation.json"),read(frozenDir,"dialogue.json"),read(source,"3-interpret.json")]);
const original=payload.result;assert.equal(original.analysis_status,"partial");assert.ok(original.structured_reasoning);
const confirmed=confirmation.result.confirmed_question;
const frozen:FrozenQuestionRecord={cast:cast.result,question:confirmed.normalized_question,confirmed_question:confirmed,confirmation_status:"confirmed",question_context:dialogue.result.confirmation_preview.question_context};
const context:ReasoningContext={frozen,question:frozen.question,planner:original.initial_analysis,agent:original.analysis_agent,identity:original.analysis_agent.snapshot.retrieval_identity};
validateReasoningContext(context);const partial=validatePartialStructuredReasoning(original.structured_reasoning,context);
const fingerprint=analysisHash(context),dir=resolve(`.runtime/evals/explainer-safe-rerender-${Date.now()}`);
await mkdir(dir,{recursive:true,mode:0o700});
const sourceFiles=[join(frozenDir,"cast.json"),join(frozenDir,"confirmation.json"),join(source,"3-interpret.json")];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,analysisHash(await readFile(file,"utf8"))])));
const before=await sourceHashes();
const response=await traceRoute("explainer-saved-rerender",new Request("http://local/explainer-rerender",{method:"POST",body:JSON.stringify({chart_id:cast.result.chart_id,source_kind:"saved_real_model_partial_program_rerender"})}),async()=>{
  const stage=await runReasoningStage("offline-rerender",context,async()=>validateReasoningContext(context),{store:{load:async()=>null,save:async()=>{}},
    synthesize:async()=>({status:"partial",value:partial,attempts:original.reasoning_diagnostic.attempts,code:original.reasoning_diagnostic.code,diagnostic_run_id:original.reasoning_diagnostic.diagnostic_run_id,failure_kind:original.reasoning_diagnostic.failure_kind})});
  assert.equal(stage.status,"partial");assert.ok(stage.modern?.explainer);assert.equal(stage.modern.explainer.generation_mode,"safe_fallback");
  assert.equal(stage.reasoning!.overall_assessment.conclusion,null);
  return Response.json({...payload,source_kind:"saved_real_model_partial_program_rerender",result:{...original,analysis_status:stage.status,structured_reasoning:stage.reasoning,modern_interpretation:stage.modern,reasoning_text:stage.text,reasoning_diagnostic:stage.diagnostic}});
});
assert.equal(analysisHash(context),fingerprint);assert.deepEqual(await sourceHashes(),before);
const save=(name:string,value:unknown)=>writeFile(join(dir,name),JSON.stringify(value,null,2),{mode:0o600,flag:"wx"});
await save("3-interpret.json",await response.json());
await save("summary.json",{source_kind:"saved_real_model_partial_program_rerender",source,frozen_source:frozenDir,source_hashes:before,chart_id:cast.result.chart_id,chart_hash:cast.result.chart_hash,no_recast:true,new_model_calls:0,analysis_status:"partial",generation_mode:"safe_fallback",trace_id:response.headers.get("X-Divination-Trace-Id"),frozen_unchanged:true});
console.log(JSON.stringify({directory:dir,analysis_status:"partial",new_model_calls:0,source_kind:"saved_real_model_partial_program_rerender"}));
