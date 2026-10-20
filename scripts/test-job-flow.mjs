import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const output = new URL(process.env.FORTUNE_OUTPUT ?? "../.runtime/evals/job-245-prompt-v2/", import.meta.url);
const replayInput = new URL("../.runtime/evals/job-245-prompt-v2/cast.json", import.meta.url);
await mkdir(output, { recursive: true });
const base = process.env.FORTUNE_TEST_URL ?? "http://localhost:3000";
let cookie = "";
async function post(path, body) {
  const response = await fetch(base + path, {
    method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(600_000),
  });
  const setCookie = response.headers.getSetCookie();
  if (setCookie.length) cookie = setCookie.map(value => value.split(";")[0]).join("; ");
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(payload.error, null);
  return payload;
}
async function confirmedTestCast(){
  assert.equal(process.env.FORTUNE_CONFIRM_TEST, "1", "新测试卦需显式设置 FORTUNE_CONFIRM_TEST=1；旧卦只支持只读回放。");
  const draft=await post("/api/divination/chat",{
    messages:[{role:"user",content:"我未来三个月能否找到工作，起卦数字2、4、5"}],
    message_id:crypto.randomUUID(),timezone:"Asia/Hong_Kong",
  });
  assert.equal(draft.result.status,"ready_for_confirmation",draft.result.message);
  const preview=draft.result.confirmation_preview;
  assert.deepEqual(preview.numbers,[2,4,5]);
  console.log("本次测试确认问事",preview.normalized_question);
  const confirmation=await post("/api/divination/confirm",{
    conversation_id:draft.result.conversation_id,revision:draft.result.draft_revision,
    question_hash:preview.question_hash,confirmed:true,
  });
  const id=confirmation.result.confirmed_question.confirmation_id;
  return post("/api/divination/cast",{confirmation_id:id,request_id:id});
}
const cast = process.env.FORTUNE_REPLAY === "1" ? JSON.parse(await readFile(replayInput, "utf8")) : await confirmedTestCast();
if (process.env.FORTUNE_REPLAY === "1") {
  assert.match(cast.result.chart_id, /^[0-9a-f-]{36}$/);
  // Recover only this local test's anonymous session, never another user's chart.
  const owner = execFileSync("sqlite3", [fileURLToPath(new URL("../fortune_module4/.runtime/liuyao-hybrid.sqlite3", import.meta.url)),
    `SELECT owner FROM frozen_cast WHERE chart_id='${cast.result.chart_id}'`], { encoding: "utf8" }).trim();
  assert.match(owner, /^anonymous:[0-9a-f-]{36}$/);
  cookie = "fortune_divination_session=" + owner.slice("anonymous:".length);
}
else await writeFile(new URL("session-cookie.txt", output), cookie, { mode: 0o600 });
await writeFile(new URL("cast.json", output), JSON.stringify(cast, null, 2));
console.log("冻结起卦完成", cast.result.chart_id);
const interpretation = await post("/api/divination/interpret", {
  chart_id: cast.result.chart_id, chart_hash: cast.result.chart_hash,
  retry: true,
});
await writeFile(new URL("interpretation.json", output), JSON.stringify(interpretation, null, 2));
const result = interpretation.result;
assert.notEqual(result.confirmation_status,"legacy_unconfirmed","旧卦仅保留原结果，不能冒充已确认问事生成新解释。");
if(process.env.FORTUNE_COMPARE === "1") {
  assert.equal(result.retrieval_plan.status,"generated",JSON.stringify(result.retrieval_plan.warnings));
  const groups={baseline:result.retrieval_plan.baseline_queries.map(query=>({query,lane:"all"})),rewritten:result.retrieval_plan.queries.filter(q=>q.lane!=="all")};
  for(const [name,queries] of Object.entries(groups)) {
    const response=await fetch("http://127.0.0.1:8001/api/v1/liuyao/hybrid/source-evidence",{
      method:"POST",headers:{"content-type":"application/json","X-Anonymous-Session":cookie.split("=")[1]},
      body:JSON.stringify({chart_id:cast.result.chart_id,chart_hash:cast.result.chart_hash,queries:queries.map(q=>q.query),query_lanes:queries.map(q=>q.lane)}),signal:AbortSignal.timeout(300_000)});
    const pack=await response.json();assert.equal(response.status,200);
    await writeFile(new URL(name+"-retrieval.json",output),JSON.stringify(pack,null,2));
    console.log(name,JSON.stringify(pack.result.hybrid_evidence.reasoning_evidence.map(e=>({id:e.entity_revision_id,kind:e.kind,title:e.summary.slice(0,65)}))));
  }
  console.log("LLM检索规划",JSON.stringify(result.retrieval_plan));
}
assert.equal(result.use_role_analysis.status, "generated");
assert.ok(result.modern_interpretation, JSON.stringify(interpretation.warnings));
const expected = result.evidence_pack.evidence.map(item => item.evidence_id).sort();
assert.deepEqual(result.modern_interpretation.readings.map(item => item.evidence_id).sort(), expected);
assert.ok(result.modern_interpretation.contextual_reflections.every(item => item.evidence_ids.length));
console.log(JSON.stringify({ warnings: interpretation.warnings, roles: result.use_role_analysis,
  retrieval: result.hybrid_evidence.reasoning_evidence.map(item => ({kind:item.kind, summary:item.summary})), interpretation: result.modern_interpretation,
  diagnostic_run_id: result.diagnostic_run_id }, null, 2));
