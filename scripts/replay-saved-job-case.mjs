// Live analysis replay only: deliberately has no chat, confirm, or cast endpoint.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const source=resolve(process.argv[2]??".runtime/evals/job-entry-245-1792072175332");
const directory=resolve(`.runtime/evals/job-entry-245-replay-${Date.now()}`);
await mkdir(directory,{recursive:true,mode:0o700});
const read=async(name)=>JSON.parse(await readFile(join(source,name),"utf8"));
const [cast,confirmation,session]=await Promise.all([read("cast.json"),read("confirmation.json"),read("private-session.json")]);
const chart=cast.result,confirmed=confirmation.result.confirmed_question;
assert.deepEqual(confirmed.numbers,[2,4,5]);assert.equal(chart.confirmation_id,confirmed.confirmation_id);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`:JSON.stringify(value);
const hash=value=>createHash("sha256").update(canonical(value)).digest("hex");
const sourceHashes=Object.fromEntries(await Promise.all(["cast.json","confirmation.json","interpretation.json"].map(async name=>[name,hash(await read(name))])));
const summary={source,directory,question:confirmed.normalized_question,chart_id:chart.chart_id,chart_hash:chart.chart_hash,question_hash:confirmed.question_hash,source_hashes:sourceHashes,stages:[],no_recast:true};
const save=(name,value)=>writeFile(join(directory,name),JSON.stringify(value,null,2),{mode:0o600,flag:"wx"});
async function post(stage,body){
  assert.ok(["frozen","plan","interpret"].includes(stage),"NO_RECAST_ENDPOINT_ALLOWLIST");
  const started=Date.now();
  const response=await fetch(`http://localhost:3000/api/divination/${stage}`,{method:"POST",headers:{"content-type":"application/json",cookie:session.cookie},body:JSON.stringify(body),signal:AbortSignal.timeout(480_000)});
  const payload=await response.json();
  const record={stage,http_status:response.status,elapsed_ms:Date.now()-started,trace_id:response.headers.get("X-Divination-Trace-Id"),trace_status:response.headers.get("X-Divination-Trace-Status")};
  summary.stages.push(record);await save(`${summary.stages.length}-${stage}.json`,payload);
  console.log(JSON.stringify(record));assert.equal(response.status,200,JSON.stringify(payload.error));assert.equal(payload.error,null);
  return payload.result;
}
try{
  console.log(JSON.stringify({event:"start",directory,chart_id:chart.chart_id,question:summary.question}));
  const before=await post("frozen",{chart_id:chart.chart_id});
  assert.equal(before.cast.chart_hash,chart.chart_hash);assert.equal(before.question,confirmed.normalized_question);
  assert.equal(hash(before.cast.core_facts),hash(chart.core_facts));
  const plan=await post("plan",{chart_id:chart.chart_id,chart_hash:chart.chart_hash});
  summary.planner_status=plan.status;summary.plan_status=plan.initial_plan?.status;summary.plan_warnings=plan.initial_plan?.warnings;
  summary.generation_mode=plan.initial_plan?.generation_mode;
  summary.generator_version=plan.initial_plan?.generator_version;
  console.log(JSON.stringify({event:"planner",status:summary.planner_status,plan_status:summary.plan_status,warnings:summary.plan_warnings}));
  assert.equal(plan.status,"ready","Planner not ready; do not start later stages");
  const result=await post("interpret",{chart_id:chart.chart_id,chart_hash:chart.chart_hash,retry:true});
  summary.analysis_status=result.analysis_status;summary.reasoning_diagnostic=result.reasoning_diagnostic;summary.assessment=result.structured_reasoning?.overall_assessment;
  summary.rounds=result.evidence_snapshot?.completed_rounds;summary.evidence_count=result.evidence_snapshot?.evidence?.length;summary.stop_reason=result.analysis_agent?.stop_reason;
  const after=await post("frozen",{chart_id:chart.chart_id});
  assert.equal(after.cast.chart_id,chart.chart_id);assert.equal(after.cast.chart_hash,chart.chart_hash);
  assert.equal(hash(after.cast.core_facts),hash(before.cast.core_facts));assert.equal(after.confirmed_question.question_hash,confirmed.question_hash);
  for(const [name,digest] of Object.entries(sourceHashes))assert.equal(hash(await read(name)),digest);
  summary.frozen_unchanged=true;
  for(const stage of summary.stages.filter(s=>s.trace_id)){
    const traceDirectory=resolve(".runtime/case-traces",stage.trace_id),records=[];
    for(const file of (await readdir(traceDirectory)).filter(f=>f.endsWith(".json")).sort())records.push({file,value:JSON.parse(await readFile(join(traceDirectory,file),"utf8"))});
    await save(`${stage.stage}-nodes.json`,{trace_id:stage.trace_id,directory:traceDirectory,records});
    if(stage.stage==="plan"){
      const model=records.filter(r=>r.value.node==="model-call"&&r.value.input?.messages?.some(m=>{
        if(m.role!=="user")return false;
        try{const input=JSON.parse(m.content);return Boolean(input.question_analysis&&input.validated_use_roles&&input.fact_catalog&&input.required_coverage);}catch{return false;}
      }));
      await save("planner-input-output.actual.json",{kind:"actual_live_trace",chart_id:chart.chart_id,chart_hash:chart.chart_hash,model_calls:model,deterministic_calls:records.filter(r=>r.value.node==="deterministic-analysis-planner"),validations:records.filter(r=>r.value.node==="planner-validation"),final_output:plan.initial_plan});
      summary.planner_actual_model_calls=model.length;
    }
  }
  summary.finished=true;
}catch(error){summary.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
await save("summary.json",summary);console.log(JSON.stringify(summary,null,2));
