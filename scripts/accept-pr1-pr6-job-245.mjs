// One user-authorized live acceptance run. Never creates a second chart on retry.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const question="我未来三个月能不能找到工作";
const directory=join(process.cwd(),".runtime","evals",`pr1-pr6-job-245-${Date.now()}`);
await mkdir(directory,{recursive:true,mode:0o700});
let cookie="";
const summary={question,numbers:[2,4,5],directory,stages:[],passed:false};
async function save(name,value){await writeFile(join(directory,name),JSON.stringify(value,null,2),{mode:0o600});}
async function post(path,body,name){
  const started=Date.now();
  const response=await fetch(`http://localhost:3000${path}`,{method:"POST",headers:{"content-type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(450_000)});
  const cookies=response.headers.getSetCookie();if(cookies.length){cookie=cookies.map(c=>c.split(";")[0]).join("; ");await save("session.json",{cookie});}
  const payload=await response.json();await save(`${name}.json`,payload);
  summary.stages.push({name,http_status:response.status,milliseconds:Date.now()-started});await save("summary.json",summary);
  return {response,payload};
}
try{
  console.log(JSON.stringify({event:"start",directory,question,numbers:summary.numbers}));
  const gate=await post("/api/divination/cast",{question,numbers:summary.numbers},"unconfirmed-gate");
  assert.equal(gate.response.status,422,"Unconfirmed direct cast must be rejected");
  const chat=await post("/api/divination/chat",{messages:[{role:"user",content:`${question}，起卦数字2、4、5`}],message_id:crypto.randomUUID(),timezone:"Asia/Hong_Kong"},"dialogue");
  assert.equal(chat.response.status,200,JSON.stringify(chat.payload.error));
  const draft=chat.payload.result;summary.dialogue_status=draft.status;
  console.log(JSON.stringify({event:"dialogue",status:draft.status,message:draft.message}));
  assert.equal(draft.status,"ready_for_confirmation","Dialogue/Q1 not ready; keep the same draft, do not cast");
  const preview=draft.confirmation_preview;
  assert.deepEqual(preview.numbers,[2,4,5]);
  // Accept only the same explicit goal/timeframe. Never confirm added job requirements.
  assert.match(preview.normalized_question,/^(我)?(在)?(未来|今后|接下来)(的)?三个月(内)?(能不能|能否|是否能|是否能够)(够)?找到(一份)?工作[？?。]?$/);
  summary.confirmed_question=preview.normalized_question;
  const confirmed=await post("/api/divination/confirm",{conversation_id:draft.conversation_id,revision:draft.draft_revision,question_hash:preview.question_hash,confirmed:true},"confirmation");
  assert.equal(confirmed.response.status,200,JSON.stringify(confirmed.payload.error));
  const confirmation=confirmed.payload.result.confirmed_question;
  const cast=await post("/api/divination/cast",{confirmation_id:confirmation.confirmation_id,request_id:confirmation.confirmation_id},"cast");
  assert.equal(cast.response.status,200,JSON.stringify(cast.payload.error));
  const frozen=cast.payload.result;summary.chart_id=frozen.chart_id;summary.chart_hash=frozen.chart_hash;
  summary.primary=frozen.primary.name;summary.transformed=frozen.transformed.name;summary.moving_lines=frozen.moving_lines;
  console.log(JSON.stringify({event:"cast",chart_id:frozen.chart_id,primary:summary.primary,transformed:summary.transformed,moving_lines:summary.moving_lines}));
  const repeated=await post("/api/divination/cast",{confirmation_id:confirmation.confirmation_id,request_id:confirmation.confirmation_id},"cast-idempotency");
  assert.equal(repeated.response.status,200);assert.equal(repeated.payload.result.chart_id,frozen.chart_id);assert.equal(repeated.payload.result.chart_hash,frozen.chart_hash);
  const interpreted=await post("/api/divination/interpret",{chart_id:frozen.chart_id,chart_hash:frozen.chart_hash},"interpretation");
  assert.equal(interpreted.response.status,200,JSON.stringify(interpreted.payload.error));
  const result=interpreted.payload.result;
  summary.system=interpreted.payload.system;summary.analysis_status=result.analysis_status;summary.planner_status=result.planner_status?.status;
  summary.rounds=result.evidence_snapshot?.completed_rounds;summary.evidence_status=result.evidence_snapshot?.status;summary.evidence_count=result.evidence_snapshot?.evidence.length;
  summary.stop_reason=result.analysis_agent?.stop_reason;summary.diagnostic=result.reasoning_diagnostic;summary.warnings=interpreted.payload.warnings;
  summary.reasoning_status=result.structured_reasoning?.overall_assessment.status;
  summary.has_text=Boolean(result.modern_interpretation);await save("summary.json",summary);
  assert.equal(interpreted.payload.system,"divination-interpret-pr6","The live run did not reach PR-6");
  assert.equal(result.analysis_status,"complete",JSON.stringify({diagnostic:summary.diagnostic,warnings:summary.warnings}));
  assert.equal(result.structured_reasoning.version,"structured-reasoning-v1");assert.equal(result.structured_reasoning.chart_hash,frozen.chart_hash);
  assert.equal(result.structured_reasoning.question_hash,confirmation.question_hash);assert.ok(result.modern_interpretation);
  summary.passed=true;
}catch(error){summary.failure=error instanceof Error?error.message:String(error);process.exitCode=1;}
await save("summary.json",summary);
console.log(JSON.stringify(summary,null,2));
