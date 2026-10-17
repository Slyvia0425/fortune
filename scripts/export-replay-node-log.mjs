// Export already saved trace files only; no network or model calls.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

assert.ok(process.argv[2],"Usage: node scripts/export-replay-node-log.mjs <completed-replay-directory>");
const directory=resolve(process.argv[2]);
const read=async name=>JSON.parse(await readFile(join(directory,name),"utf8"));
const [summary,plan,interpret]=await Promise.all([read("summary.json"),read("plan-nodes.json"),read("interpret-nodes.json")]);
assert.equal(summary.frozen_unchanged,true,"Frozen identity verification must finish first");
// Identify P1 by its payload contract, not the wording of a versioned system prompt.
const plannerCalls=plan.records.filter(record=>record.value.node==="model-call"&&record.value.input?.messages?.some(message=>{
  if(message.role!=="user")return false;
  try{const input=JSON.parse(message.content);return Boolean(input.question_analysis&&input.validated_use_roles&&input.fact_catalog&&input.required_coverage);}catch{return false;}
}));
summary.planner_actual_model_calls=plannerCalls.length;
const plannerOutput=await read("2-plan.json");
const plannerBundle={kind:"actual_live_trace",chart_id:summary.chart_id,chart_hash:summary.chart_hash,model_calls:plannerCalls,
  validations:plan.records.filter(record=>record.value.node==="planner-validation"),final_output:plannerOutput.result.initial_plan};
for(const [name,value] of [["summary.json",summary],["planner-input-output.actual.json",plannerBundle]])await writeFile(join(directory,name),JSON.stringify(value,null,2),{mode:0o600});
const nodes=[...plan.records.map(record=>({phase:"plan",trace_id:plan.trace_id,source_file:join(plan.directory,record.file),...record.value})),
  ...interpret.records.map(record=>({phase:"interpret",trace_id:interpret.trace_id,source_file:join(interpret.directory,record.file),...record.value}))].filter(record=>record.node);
const output={version:"saved-replay-node-log-v1",summary,notice:"Private business data; credentials are redacted. returned/complete are execution states, not proof of professional correctness.",
  not_executed:["front_dialogue","question_confirmation","casting","Q1_model_call (reused frozen question analysis)"],
  reading_guide:{input:"Actual node input; model-call messages contain exact prompts and user payload.",output:"Actual return value; model-call choices.content is raw model text.",error:"Thrown error, if any; inspect business status even when status=returned."},
  node_index:nodes.map(node=>({phase:node.phase,sequence:node.sequence,node:node.node,status:node.status,elapsed_ms:node.elapsed_ms,source_file:node.source_file})),nodes};
const destination=join(directory,"all-node-input-output.actual.json");
await writeFile(destination,JSON.stringify(output,null,2),{mode:0o600});
console.log(JSON.stringify({file:destination,nodes:nodes.length,planner_model_calls:plannerCalls.length}));
