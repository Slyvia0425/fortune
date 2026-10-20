import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { traceNode, traceRoute, tracedModelFetch, redactTrace } from "../lib/server/case-trace";
import { planAnalysisTasks } from "../lib/server/analysis-planner-llm";
import { minimumAnalysisPlan } from "../lib/divination/analysis-plan";
import { validateQuestionAnalysis } from "../lib/divination/question-analysis";
import { emptyQuestionContext } from "../lib/divination/core";
import { validateUseRoles } from "../lib/divination/fixed-use-rules";
import { extractAnalysisFacts } from "../lib/divination/analysis-facts";

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
const request=(body:unknown={chart_id:"chart-A"})=>new Request("http://localhost/api/divination/interpret",{method:"POST",headers:{"content-type":"application/json",cookie:"must-not-save","authorization":"Bearer must-not-save"},body:JSON.stringify(body)});
async function files(root:string,response:Response){
  const dir=join(root,response.headers.get("X-Divination-Trace-Id")!);
  const records=await Promise.all((await readdir(dir)).filter(f=>f.endsWith(".json")).map(async name=>({name,value:JSON.parse(await readFile(join(dir,name),"utf8"))})));
  return {dir,records};
}

it("records inputs, raw model content, usage, validated outputs, and private permissions without headers",async()=>{
  const root=await mkdtemp(join(tmpdir(),"fortune-trace-"));
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({model:"fixture-model",choices:[{message:{content:'{"tasks":[]}',reasoning_content:"not-saved"},finish_reason:"stop"}],usage:{prompt_tokens:20,completion_tokens:5}})));
  const response=await traceRoute("interpret",request(),async()=>{
    await tracedModelFetch("http://model",{method:"POST",headers:{authorization:"Bearer must-not-save"},body:JSON.stringify({messages:[{role:"system",content:"planner prompt"}],api_key:"hidden"})});
    const output=await traceNode("planner-validation",{raw_output:'{"tasks":[]}'},()=>({status:"fallback",warnings:["PLAN_TOPIC_INVALID"]}));
    return Response.json(output);
  },root);
  const {dir,records}=await files(root,response),serialized=JSON.stringify(records);
  expect(response.headers.get("X-Divination-Trace-Status")).toBe("complete");
  expect(serialized).toContain("planner prompt");expect(serialized).toContain("PLAN_TOPIC_INVALID");expect(serialized).toContain("prompt_tokens");
  expect(serialized).not.toContain("must-not-save");expect(serialized).not.toContain("not-saved");expect(serialized).not.toContain('"hidden"');
  expect((await stat(dir)).mode&0o777).toBe(0o700);expect((await stat(join(dir,"manifest.json"))).mode&0o777).toBe(0o600);
});
it("persists thrown validation errors and leaves business errors unchanged",async()=>{
  const root=await mkdtemp(join(tmpdir(),"fortune-trace-"));
  const response=await traceRoute("plan",request(),async()=>{
    await expect(traceNode("validation",{attempt:1},()=>{throw new Error("PLAN_TOPIC_INVALID");})).rejects.toThrow("PLAN_TOPIC_INVALID");
    return Response.json({status:"fallback"});
  },root);
  const {records}=await files(root,response);expect(records.find(r=>r.value.node==="validation")?.value).toMatchObject({status:"threw",error:{message:"PLAN_TOPIC_INVALID"}});
});
it("keeps concurrent requests isolated and records explicit cache hits without new model calls",async()=>{
  const root=await mkdtemp(join(tmpdir(),"fortune-trace-"));
  const responses=await Promise.all(["A","B"].map(chart=>traceRoute("plan",request({chart_id:chart}),async()=>Response.json(await traceNode("planner-cache-hit",{chart_id:chart},async()=>{await Promise.resolve();return {chart_id:chart,status:"ready"};})),root)));
  for(const [i,response] of responses.entries()){
    const {records}=await files(root,response);const value=records.find(r=>r.value.node==="planner-cache-hit")?.value;
    expect(value.input.chart_id).toBe(i===0?"A":"B");expect(value.output.chart_id).toBe(value.input.chart_id);
    expect(records.some(r=>r.value.node==="model-call")).toBe(false);
  }
  expect(responses[0].headers.get("X-Divination-Trace-Id")).not.toBe(responses[1].headers.get("X-Divination-Trace-Id"));
});
it("can disable tracing and redacts credentials inside JSON strings",async()=>{
  vi.stubEnv("LIUYAO_CASE_TRACE","false");
  const root=await mkdtemp(join(tmpdir(),"fortune-trace-"));
  const response=await traceRoute("plan",request(),async()=>Response.json({ok:true}),root);
  expect(await readdir(root)).toEqual([]);expect(response.headers.has("X-Divination-Trace-Id")).toBe(false);
  expect(JSON.stringify(redactTrace({raw_output:'{"token":"private","message":"Bearer abc"}'}))).not.toContain("private");
  expect(redactTrace('{\n  "tasks": []\n}')).toBe('{\n  "tasks": []\n}');
});
it("logging failure is visible but does not change analysis results",async()=>{
  const root=await mkdtemp(join(tmpdir(),"fortune-trace-")),blocked=join(root,"file-not-directory");await writeFile(blocked,"fixture");
  vi.spyOn(console,"error").mockImplementation(()=>{});
  const response=await traceRoute("plan",request(),async()=>Response.json({ok:true}),blocked);
  expect(await response.json()).toEqual({ok:true});expect(response.headers.get("X-Divination-Trace-Status")).toBe("partial");
});
it("captures a real P1 validation retry and final fallback without a live model",async()=>{
  const root=await mkdtemp(join(tmpdir(),"fortune-trace-"));
  const question="能找到工作吗",context=emptyQuestionContext(question);
  const q=validateQuestionAnalysis({status:"valid",issue_count:1,issues:[],normalized_question:question,domain:"career",event_type:"new_job",question_type:"outcome",raw_event_description:question,actors:[],relationships:[],subject_actor_id:null,current_state:null,current_state_evidence:null,target_state:null,target_state_evidence:null,time_constraint:null,explicit_context:[]},context);
  const core=JSON.parse(await readFile(new URL("../docs/examples/liuyao-245-core.json",import.meta.url),"utf8"));
  const roles=validateUseRoles(JSON.stringify({primary:{role:"officials",rule_id:"career",meaning:"职位",reason:"求职"},auxiliary:[{role:"self",rule_id:"career",meaning:"本人",reason:"观察自己"}],missing_information:[],uncertainties:[]}),core,"fixture-chart");
  const facts=extractAnalysisFacts(core,roles,"fixture-chart"),valid=minimumAnalysisPlan(facts,q,"question-hash","fixture");
  const complete=vi.fn().mockResolvedValue(JSON.stringify({tasks:valid.tasks.map(t=>({...t,fact_refs:["nonexistent_fact"]}))}));
  const response=await traceRoute("plan",request(),async()=>Response.json(await planAnalysisTasks(q,roles,facts,"question-hash",complete)),root);
  expect(complete).toHaveBeenCalledTimes(2);
  const {records}=await files(root,response),validation=records.filter(r=>r.value.node==="planner-validation");
  expect(validation).toHaveLength(2);expect(validation.every(r=>r.value.status==="threw")).toBe(true);
  expect(records.find(r=>r.value.node==="analysis-planner")?.value.output.status).toBe("fallback");
});
