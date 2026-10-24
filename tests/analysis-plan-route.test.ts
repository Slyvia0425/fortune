import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrozenQuestionRecord, LiuyaoCoreFacts, QuestionContext } from "../lib/contracts/divination";
import { emptyQuestionContext } from "../lib/divination/core";
import { validateUseRoles } from "../lib/divination/fixed-use-rules";
import { validateQuestionAnalysis } from "../lib/divination/question-analysis";
import { minimumAnalysisPlan } from "../lib/divination/analysis-plan";
import type { FactCatalog } from "../lib/divination/analysis-facts";
import type { SingleQuestionAnalysis } from "../lib/divination/question-analysis";
const services=vi.hoisted(()=>({call:vi.fn(),roles:vi.fn(),model:vi.fn(),write:vi.fn(),cache:vi.fn(),agentStates:new Map<string,unknown>(),agentSaves:vi.fn(),stageStates:new Map<string,unknown>()}));
vi.mock("../lib/server/liuyao-hybrid",()=>({callHybrid:services.call,HybridServiceError:class extends Error{status=404;}}));
vi.mock("../lib/server/divination-llm",()=>({determineUseRoles:services.roles,analysisModelIdentity:()=>"test-model",analysisModelProfile:()=>"test-model-profile",requestPlannerJson:services.model,divinationLlmConfigured:()=>true,interpretDivinationEvidence:services.write}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>({value:"owner"})})}));
vi.mock("../lib/server/module4-auth",()=>({AUTH_COOKIE:"auth"}));
vi.mock("../lib/server/interpretation-cache",()=>({cachedInterpretation:services.cache}));
vi.mock("../lib/server/evidence-agent-store",()=>({evidenceAgentStore:(owner:string,key:string)=>({load:async()=>services.agentStates.get(owner+key)??null,save:async(state:unknown)=>{services.agentStates.set(owner+key,structuredClone(state));services.agentSaves(state);}})}));
vi.mock("../lib/server/reasoning-stage-store",()=>({reasoningStageStore:(owner:string,key:string)=>({load:async(stage:string)=>services.stageStates.get(owner+key+stage)??null,save:async(stage:string,value:unknown)=>{services.stageStates.set(owner+key+stage,structuredClone(value));}})}));
import { POST as planRoute } from "../app/api/divination/plan/route";
import { POST as interpretRoute } from "../app/api/divination/interpret/route";
import { compileRetrievalRequests, initialRetrievalRequests } from "../lib/divination/query-compiler";
import { fallbackRetrievalPlan } from "../lib/divination/retrieval-plan";
import type { InitialPlannerSnapshot } from "../lib/server/analysis-planner";
import { emptyEvidenceSnapshot, mergeEvidence, accumulatedEvidencePack } from "../lib/divination/evidence-accumulator";
import type { HybridEvidencePack } from "../lib/contracts/divination";
import { validateStructuredReasoning, type ReasoningContext } from "../lib/divination/structured-reasoning";
import { reasoningTextTemplate, renderReasoningText } from "../lib/divination/reasoning-text";
import { reasoningDraft } from "./fixtures/reasoning-fixture";
import { resolveReviewedUseRoles, USE_ROLE_RULE_VERSION } from "../lib/divination/deterministic-use-roles";
import { lightweightExplainerDraft as explainerDraft } from "./fixtures/explainer-fixture";
import type { BuiltReasoningInput } from "../lib/divination/reasoning-input";

const cid="00000000-0000-0000-0000-000000000001",confirmationId="00000000-0000-0000-0000-000000000002";
const core=JSON.parse(readFileSync(new URL("../docs/examples/liuyao-245-core.json",import.meta.url),"utf8")) as LiuyaoCoreFacts;
let record:FrozenQuestionRecord,persisted:InitialPlannerSnapshot|null;
function setup(question:string,domain="career",event="new_job",role="officials",rule="career"){
  const context:QuestionContext={...emptyQuestionContext(question),parser_status:"parsed",goal_groups:[question],goal:{value:question,provenance:"user_explicit",verification_status:"extracted"}};
  const q1=validateQuestionAnalysis({status:"valid",issue_count:1,issues:[],normalized_question:question,domain,event_type:event,raw_event_description:question,question_type:"outcome",subject_actor_id:null,actors:[],relationships:[],current_state:null,current_state_evidence:null,target_state:null,target_state_evidence:null,time_constraint:null,explicit_context:[]},context);
  const hex={number:17,name:"随",upper_trigram:"兑",lower_trigram:"震",lines:[9,8,8,9,9,8]};
  record={cast:{chart_id:cid,chart_hash:"chart-hash",confirmation_id:confirmationId,question_hash:"question-hash",core_facts:core,primary:hex,transformed:{...hex,number:43,name:"夬"},mutual:hex,moving_lines:[1,2,3,4,5]} as FrozenQuestionRecord["cast"],question,question_context:context,question_analysis:q1,confirmation_status:"confirmed",
    confirmed_question:{version:"confirmed-question-v1",confirmation_id:confirmationId,question_hash:"question-hash",normalized_question:question,numbers:[2,4,5],timezone:"Asia/Hong_Kong",confirmed_at:"2026-10-14T00:00:00Z",source:"explicit_user_action",state:"confirmed",context:{initiator:null,number_provider:null,perspective_person:null,target_entities:[],relationships:[],known_facts:[],process_stage:null,time_expression:null,exclusions:[]}}};
  services.roles.mockResolvedValue(validateUseRoles(JSON.stringify({primary:{role,rule_id:rule,meaning:"问事主观察角色",reason:"依据固定分支"},auxiliary:rule==="career"?[{role:"self",rule_id:"career",meaning:"本人",reason:"固定求职分支要求观察世爻"}]:[],missing_information:[],uncertainties:[]}),core,"chart-hash"));
}
const request=(body:unknown={chart_id:cid})=>new Request("http://localhost/api/divination/plan",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{
  vi.stubEnv("LIUYAO_REASONING_MODE","strict"); // Retained semantic-validator fixtures; full mode has separate coverage.
  vi.stubEnv("LIUYAO_PLANNER_MODE","llm"); // Exercise the retained legacy mode; default mode is covered below.
  vi.stubEnv("LIUYAO_RETRIEVAL_PIPELINE","pr4");
  vi.resetAllMocks();services.agentStates.clear();services.stageStates.clear();persisted=null;setup("能找到工作吗");
  services.cache.mockImplementation((_owner:unknown,_input:unknown,_retry:unknown,generate:()=>Promise<Response>)=>generate());
  services.write.mockResolvedValue({interpretation:{overall_interpretation:"旧写作节点基线"},model:"test"});
  services.model.mockImplementation(async(_system:string,input:Record<string,unknown>)=>JSON.stringify({tasks:minimumAnalysisPlan(input.fact_catalog as FactCatalog,input.question_analysis as SingleQuestionAnalysis,"question-hash","TEST").tasks}));
  services.call.mockImplementation(async(path:string,body:Record<string,unknown>)=>{
    if(path==="frozen")return record;
    if(path==="analysis-plan"){if(body.plan&&!persisted)persisted=body.plan as InitialPlannerSnapshot;return {plan:persisted};}
    if(path==="source-profile")return {knowledge_release_id:"same-sqlite",embedding_profile:"profile-v1"};
    if(path==="source-evidence-round")return {hybrid_evidence:{chart_id:cid,chart_hash:"chart-hash",retrieval_identity:body.retrieval_identity,reasoning_evidence:[],gaps:["NO_SOURCE_EVIDENCE"]}};
    throw new Error("UNEXPECTED_SERVICE_CALL");
  });
});

describe("PR-5 interpret双轮与恢复接线",()=>{
  it("同一已有SQLite与245盘：两轮真实来源hash/span可进入累计器",async()=>{
    await planRoute(request());const p=persisted!,first=compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis);
    const parent=p.initial_plan.tasks[0];
    const requests=[{request_id:"r2_1",parent_task_id:parent.task_id,target_type:"theory" as const,topic_ids:["use_role" as const],semantic_intent:"补查用神条件",keyword_terms:["用神条件"],fact_refs:[],priority:parent.priority}];
    const second=compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis,requests,2);
    const data=JSON.parse(execFileSync("fortune_module4/.venv/bin/python",["fortune_module4/scripts/retrieve_pr5_fixture.py"],{
      input:JSON.stringify({chart_id:cid,chart_hash:p.chart_hash,core,rounds:[first.queries,second.queries]}),encoding:"utf8",timeout:30000,env:{...process.env,PYTHONPATH:"fortune_module4"},
    })) as {identity:Record<string,unknown>;packs:HybridEvidencePack[]};
    let snapshot=emptyEvidenceSnapshot(p.chart_hash,p.question_hash,data.identity);
    snapshot=mergeEvidence(snapshot,{round:1,requests:first.requests,pack:data.packs[0]});
    const firstIds=snapshot.evidence.map(e=>e.evidence_id);
    snapshot=mergeEvidence(snapshot,{round:2,requests,pack:data.packs[1]});
    expect(snapshot.completed_rounds).toBe(2);expect(snapshot.evidence.length).toBeGreaterThan(0);
    expect(firstIds.every(id=>snapshot.evidence.some(e=>e.evidence_id===id))).toBe(true);
    expect(snapshot.evidence.every(e=>e.quote_hash.length===64&&e.source_span_id&&e.origins.length)).toBe(true);
    expect(accumulatedEvidencePack(snapshot)?.reasoning_evidence?.length).toBeGreaterThanOrEqual(data.packs[0].reasoning_evidence!.length);
    expect(data.packs.every(pack=>pack.reasoning_evidence?.every(u=>u.kind==="passage"))).toBe(true);
    const context:ReasoningContext={question:record.question,planner:p,identity:data.identity,agent:{version:"bounded-agent-pr5-v1",snapshot,supplemental_tasks:[],stop_reason:"ROUND_LIMIT",terminal:true,fingerprint:"SQLITE_FIXTURE"}};
    const reasoning=validateStructuredReasoning(reasoningDraft(context),context);
    const modern=renderReasoningText(reasoningTextTemplate(reasoning),reasoning);
    expect(reasoning.findings.length).toBe(p.initial_plan.tasks.length);expect(modern.contextual_reflections.length).toBeGreaterThan(0);
    expect(reasoning.findings.flatMap(f=>f.evidence_ids).every(id=>snapshot.evidence.some(e=>e.evidence_id===id))).toBe(true);
  },30000);
  function prepare(){
    vi.stubEnv("LIUYAO_RETRIEVAL_PIPELINE","pr5");
    const original=services.call.getMockImplementation()!;
    services.call.mockImplementation(async(path:string,body:Record<string,unknown>)=>{
      if(path!=="source-evidence-round")return original(path,body);
      const requests=body.query_requests as {request_id:string;parent_task_id:string;round:1|2}[],round=requests[0].round;
      if(round===2)expect(services.agentSaves.mock.calls.some(c=>c[0].snapshot.completed_rounds===1)).toBe(true);
      const quote=round===1?"用神一般定义，需要核验条件。":"用神的例外条件，仍待核验。";
      const unit={entity_revision_id:`unit-${round}`,entity_id:`unit-${round}`,kind:"passage",summary:quote,condition_evaluation:"unknown",not_for_interpretation:false,conflict_group_ids:[],content_type:"theory",
        source_quotes:[{source_revision_id:"source1",start:round===1?0:100,end:(round===1?0:100)+[...quote].length,quote,quote_hash:createHash("sha256").update(quote).digest("hex"),offset_unit:"unicode_codepoint"}]};
      return {hybrid_evidence:{chart_id:cid,chart_hash:"chart-hash",knowledge_release_id:"same-sqlite",retrieval_identity:body.retrieval_identity,retrieval_run_id:`run${round}`,reasoning_evidence:[unit],gaps:[],pending_conditions:[unit],
        interpretation_contract:{strong_conclusion_allowed:false,recast_allowed:false,copy_case_outcome:false},
        retrieval_trace:requests.map(r=>({...r,keyword_hits:1,vector_hits:0,selected_evidence_ids:[unit.entity_revision_id],keyword_top:[{entity_revision_id:unit.entity_revision_id,score:round}]}))}};
    });
    const originalModel=services.model.getMockImplementation()!;
    services.model.mockImplementation(async(system:string,input:Record<string,unknown>)=>{
      if(!system.includes("Evidence Gap Analyzer"))return originalModel(system,input);
      const task=(input.immutable_initial_tasks as {task_id:string;priority:string}[])[0];
      return JSON.stringify({decision:"retrieve_more",proposals:[{parent_task_id:task.task_id,trigger_type:"task_gap",topic_ids:["use_role"],knowledge_need:"补查用神条件"}]});
    });
  }
  function prepare6(){
    prepare();vi.stubEnv("LIUYAO_RETRIEVAL_PIPELINE","");const original=services.model.getMockImplementation()!;
    services.model.mockImplementation(async(system:string,input:Record<string,unknown>)=>{
      if(system.includes("Reasoning Synthesizer")){
        const tasks=input.allowed_tasks as {task_id:string;parent_task_id:string;fact_refs:string[]}[];
        const evidence=input.evidence as {evidence_id:string;task_ids:string[]}[];
        return JSON.stringify({findings:tasks.map(t=>({task_id:t.task_id,fact_refs:t.fact_refs,
            evidence_ids:evidence.filter(e=>e.task_ids.includes(t.parent_task_id)).map(e=>e.evidence_id),interpretation:"当前资料可作条件对照，尚不能据此确定所问结果。",status:"conditional",limitations:["理论适用前提尚待核验。","不预测现实结果。"]})),
          synthesis:{status:"conditional",conclusion:"仅能作有条件的传统解释。",limitations:["不构成对未来事实的证明。"]},explainer:explainerDraft(input as unknown as BuiltReasoningInput["input"])});
      }
      if(system.includes("最终写作组织节点"))return JSON.stringify(input.output_template);
      return original(system,input);
    });
  }
  it("确定性P1贯通双轮检索、PR6及写作，无规划模型调用",async()=>{
    prepare6();vi.stubEnv("LIUYAO_PLANNER_MODE","deterministic");
    const response=await interpretRoute(request()),body=await response.json();
    expect(response.status).toBe(200);expect(body.result.analysis_status).toBe("complete");
    expect(body.result.initial_analysis.initial_plan.generation_mode).toBe("deterministic");
    expect(services.model.mock.calls.filter(c=>c[0].includes("Evidence Gap Analyzer"))).toHaveLength(1);
    expect(services.model.mock.calls.filter(c=>c[0].includes("Reasoning Synthesizer"))).toHaveLength(1);
    expect(services.model).toHaveBeenCalledTimes(2);expect(services.write).not.toHaveBeenCalled();
    expect(body.result.structured_reasoning.findings.every((f:{fact_refs:string[]})=>f.fact_refs.every(id=>body.result.initial_analysis.fact_catalog.facts.some((x:{fact_id:string})=>x.fact_id===id)))).toBe(true);
  });
  it("PR-6 默认必须先推理后写作；两轮引用贯通，不再调用旧解释",async()=>{
    prepare6();const response=await interpretRoute(request()),body=await response.json();
    expect(response.status).toBe(200);expect(body.result.analysis_status).toBe("complete");expect(body.result.structured_reasoning.version).toBe("structured-reasoning-v1");
    expect(body.result.modern_interpretation.overall_interpretation).toContain("断语");
    expect(body.result.structured_reasoning.findings[0].limitations).toContain("理论适用前提尚待核验。");
    expect(services.write).not.toHaveBeenCalled();expect(services.model).toHaveBeenCalledTimes(3);expect(services.roles).toHaveBeenCalledTimes(1);
    expect(services.cache.mock.calls[0][1].pipeline_version).toBe("analysis-planner-v4.1-pr6");
    const input=services.model.mock.calls.find(c=>c[0].includes("Reasoning Synthesizer"))![1];expect(input.evidence).toHaveLength(2);
    expect(services.model.mock.calls.some(c=>c[0].includes("最终写作组织节点"))).toBe(false);
    await interpretRoute(request({chart_id:cid,retry:true}));expect(services.model).toHaveBeenCalledTimes(3);expect(services.roles).toHaveBeenCalledTimes(1);
    expect(services.call.mock.calls.filter(c=>c[0]==="source-evidence-round")).toHaveLength(2);
  });
  it("PR6.5 本人确定性取用与有向事实贯通Planner、两轮证据、推理、写作及恢复",async()=>{
    prepare6();
    record.question="我能找到工作吗";
    record.question_context={...record.question_context!,raw_question:record.question};
    record.confirmed_question={...record.confirmed_question!,normalized_question:record.question};
    const q={...record.question_analysis!,normalized_question:record.question,subject_actor_id:"querent",
      actors:[{id:"querent",label:"我",role:"querent" as const,evidence:{source_id:"question",start:0,end:1,text:"我"}}]};
    record.question_analysis=q;
    services.roles.mockImplementation(async(c:LiuyaoCoreFacts,_question:string,hash:string)=>{
      const resolved=resolveReviewedUseRoles(c,hash,q);
      expect(resolved.status).toBe("resolved");
      return resolved.analysis!;
    });
    const before=JSON.stringify(core);
    const body=await (await interpretRoute(request())).json();
    expect(body.result.analysis_status).toBe("complete");
    expect(persisted!.use_roles.rules_version).toBe(USE_ROLE_RULE_VERSION);
    const direction=persisted!.fact_catalog.facts.find(f=>f.subject_ref==="main:3"&&f.object_ref==="main:5");
    expect(direction?.value).toMatchObject({element_relation:"generates",source_element:"土",target_element:"金"});
    const reasoningInput=services.model.mock.calls.find(c=>c[0].includes("Reasoning Synthesizer"))![1];
    expect(reasoningInput.fact_catalog.chart_hash).toBe(persisted!.fact_catalog.chart_hash);
    expect(reasoningInput.fact_catalog.facts.some((f:{subject_ref:string;object_ref?:string;value:unknown})=>f.subject_ref==="main:3"&&f.object_ref==="main:5"&&JSON.stringify(f.value).includes("generates"))).toBe(true);
    expect(reasoningInput.evidence).toHaveLength(2);
    expect(body.result.structured_reasoning.chart_hash).toBe(record.cast.chart_hash);
    expect(body.result.modern_interpretation).toBeTruthy();
    const calls=services.model.mock.calls.length;
    await interpretRoute(request({chart_id:cid,retry:true}));
    expect(services.model).toHaveBeenCalledTimes(calls);
    expect(services.roles).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(core)).toBe(before);
  });
  it("PR-6 G12非法推理两次后停止，禁止调用新旧写作节点",async()=>{
    prepare6();const original=services.model.getMockImplementation()!;
    services.model.mockImplementation(async(system:string,input:Record<string,unknown>)=>system.includes("Reasoning Synthesizer")?"bad":original(system,input));
    const body=await (await interpretRoute(request())).json();expect(body.result.analysis_status).toBe("reasoning_failed");expect(body.result.modern_interpretation).toBeNull();expect(body.result.evidence_snapshot.completed_rounds).toBe(2);
    expect(services.model.mock.calls.filter(c=>c[0].includes("Reasoning Synthesizer"))).toHaveLength(2);expect(services.model.mock.calls.some(c=>c[0].includes("最终写作组织节点"))).toBe(false);expect(services.write).not.toHaveBeenCalled();
  });
  it("PR-6 默认最终写作不调用模型，模型不可用也不影响已验证文本投影",async()=>{
    prepare6();const original=services.model.getMockImplementation()!;
    services.model.mockImplementation(async(system:string,input:Record<string,unknown>)=>system.includes("最终写作组织节点")?"bad":original(system,input));
    const first=(await (await interpretRoute(request())).json()).result;expect(first.analysis_status).toBe("complete");expect(first.structured_reasoning.findings.length).toBeGreaterThan(0);expect(first.modern_interpretation).toBeTruthy();
    services.model.mockImplementation(original);const second=(await (await interpretRoute(request({chart_id:cid,retry:true}))).json()).result;expect(second.analysis_status).toBe("complete");
    expect(services.model.mock.calls.filter(c=>c[0].includes("Reasoning Synthesizer"))).toHaveLength(1);expect(services.roles).toHaveBeenCalledTimes(1);expect(services.call.mock.calls.filter(c=>c[0]==="source-evidence-round")).toHaveLength(2);
  });
  it("PR-6 知识身份在推理后变化，不将旧分析交付写作",async()=>{
    prepare6();const original=services.call.getMockImplementation()!;let profiles=0;
    services.call.mockImplementation(async(path:string,body:Record<string,unknown>)=>{const result=await original(path,body);if(path==="source-profile"&&++profiles===3)return {...result,embedding_profile:"changed"};return result;});
    const body=await (await interpretRoute(request())).json();expect(body.result.analysis_status).toBe("reasoning_failed");expect(body.result.modern_interpretation).toBeNull();expect(body.result.reasoning_diagnostic.code).toBe("REASONING_IDENTITY_CHANGED");
    expect(services.model.mock.calls.some(c=>c[0].includes("最终写作组织节点"))).toBe(false);
  });
  it("默认新链路执行两轮，只一次G1，写作收到两轮并集；重试复用checkpoint",async()=>{
    prepare();vi.stubEnv("LIUYAO_RETRIEVAL_PIPELINE","pr5");
    const response=await interpretRoute(request()),body=await response.json();
    expect(response.status).toBe(200);expect(body.result.evidence_snapshot.completed_rounds).toBe(2);
    expect(services.cache.mock.calls[0][1].pipeline_version).toBe("analysis-planner-v4.1-pr5");
    expect(services.model).toHaveBeenCalledTimes(2);expect(services.roles).toHaveBeenCalledTimes(1);
    expect(services.write.mock.calls[0][1].evidence.reasoning_evidence.map((u:{entity_revision_id:string})=>u.entity_revision_id)).toEqual(["unit-1","unit-2"]);
    expect(services.call.mock.calls.filter(c=>c[0]==="source-evidence-round")).toHaveLength(2);
    await interpretRoute(request({chart_id:cid,retry:true}));
    expect(services.call.mock.calls.filter(c=>c[0]==="source-evidence-round")).toHaveLength(2);expect(services.model).toHaveBeenCalledTimes(2);expect(services.roles).toHaveBeenCalledTimes(1);
  });
  it("第二轮失败仍返回第一轮证据、partial与缺口，不重新起卦",async()=>{
    prepare();const original=services.call.getMockImplementation()!;
    services.call.mockImplementation(async(path:string,body:Record<string,unknown>)=>{
      if(path==="source-evidence-round"&&(body.query_requests as {round:number}[])[0].round===2)throw new Error("WORKFLOW_NODE_TIMEOUT");
      return original(path,body);
    });
    const response=await interpretRoute(request()),body=await response.json();
    expect(response.status).toBe(200);expect(body.result.evidence_snapshot.status).toBe("partial");expect(body.result.evidence_snapshot.completed_rounds).toBe(1);
    expect(body.result.evidence_snapshot.unresolved_gaps.length).toBeGreaterThan(0);expect(body.result.evidence_snapshot.errors).toContain("WORKFLOW_NODE_TIMEOUT");
    expect(services.write.mock.calls[0][1].evidence.reasoning_evidence).toHaveLength(1);expect(services.call.mock.calls.some(c=>c[0]==="cast")).toBe(false);
  });
  it("最终写作失败也保留累计快照",async()=>{
    prepare();services.write.mockRejectedValue(new Error("TimeoutError"));
    const body=await (await interpretRoute(request())).json();expect(body.result.modern_interpretation).toBeNull();expect(body.result.evidence_snapshot.completed_rounds).toBe(2);
  });
  it("两轮均无资料不调用写作、不伪造解读",async()=>{
    prepare();const original=services.call.getMockImplementation()!;
    services.call.mockImplementation(async(path:string,body:Record<string,unknown>)=>{
      const result=await original(path,body);
      if(path==="source-evidence-round"){
        const pack=result.hybrid_evidence;pack.reasoning_evidence=[];pack.pending_conditions=[];
        pack.retrieval_trace=pack.retrieval_trace.map((t:Record<string,unknown>)=>({...t,keyword_hits:0,selected_evidence_ids:[]}));
      }
      return result;
    });
    const body=await (await interpretRoute(request())).json();expect(body.result.modern_interpretation).toBeNull();expect(body.result.evidence_snapshot.completed_rounds).toBe(2);expect(services.write).not.toHaveBeenCalled();
  });
});

describe("PR-4 单轮接线与受控编译",()=>{
  it("在同一现有SQLite与冻结245盘上执行V1/V4理论检索对照",async()=>{
    await planRoute(request());const p=persisted!;
    const compiled=compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis);
    const legacy=fallbackRetrievalPlan(record.question,core,p.use_roles,"BASELINE");
    const result=JSON.parse(execFileSync("fortune_module4/.venv/bin/python",["fortune_module4/scripts/compare_pr4_queries.py"],{
      input:JSON.stringify({chart_id:cid,chart_hash:p.chart_hash,core,v1:legacy.queries,v4_1:compiled.queries}),encoding:"utf8",timeout:30000,
      env:{...process.env,PYTHONPATH:"fortune_module4"},
    }));
    expect(result.v4_1.case_count).toBe(0);expect(result.v4_1.evidence_count).toBeGreaterThan(0);
    expect(result.v4_1.task_traces).toHaveLength(compiled.queries.length);
    expect(result.v1.knowledge_release_id).toBe(result.v4_1.knowledge_release_id);
    expect(result.v1.chart_hash).toBe(result.v4_1.chart_hash);
    expect(result.v4_1.task_traces.every((t:{parent_task_id:string;round:number})=>t.parent_task_id&&t.round===1)).toBe(true);
    if(process.env.PR4_COMPARISON_REPORT==="1")console.info(JSON.stringify({identity:result.retrieval_identity,v1:{queries:legacy.queries.map(q=>q.query),evidence_count:result.v1.evidence_count,case_count:result.v1.case_count},v4_1:{queries:compiled.queries.map(q=>q.query),evidence_count:result.v4_1.evidence_count,case_count:result.v4_1.case_count,task_traces:result.v4_1.task_traces.map((t:Record<string,unknown>)=>({task_id:t.parent_task_id,keyword_hits:t.keyword_hits,selected_evidence_ids:t.selected_evidence_ids}))}}));
  },30000);
  it.each([
    ["我与前任能复合吗","relationship","reconciliation","response","response"],
    ["我作为男方问女方今年能否结婚","relationship","marriage","wealth","marriage-woman"],
    ["借出去的钱能否收回","finance","debt_repayment","wealth","wealth"],
  ])("%s 复用通用规划完成首轮检索",async(question,domain,event,role,rule)=>{
    setup(question,domain,event,role,rule);
    const response=await interpretRoute(request()),body=await response.json();
    expect(response.status).toBe(200);expect(body.result.compiled_retrieval.queries.length).toBeGreaterThan(0);
    expect(body.result.initial_analysis.question_analysis.event_type).toBe(event);
    expect(services.roles).toHaveBeenCalledTimes(1);
  });
  it("复用已保存计划与取用，只执行一次最多五条理论查询",async()=>{
    await planRoute(request());
    const result=(await (await interpretRoute(request())).json()).result;
    expect(result.compiled_retrieval.queries.length).toBeLessThanOrEqual(5);
    expect(result.compiled_retrieval.queries.every((q:{lane:string})=>q.lane==="theory")).toBe(true);
    expect(result.query_comparison.baseline_executed).toBe(false);
    expect(services.roles).toHaveBeenCalledTimes(1);expect(services.model).toHaveBeenCalledTimes(1);
    const calls=services.call.mock.calls.filter(c=>c[0]==="source-evidence-round");
    expect(calls).toHaveLength(1);expect(calls[0][2]).toBe(true);
    expect(calls[0][1].query_requests).toHaveLength(calls[0][1].queries.length);
    expect(services.call.mock.calls.some(c=>["cast","source-evidence"].includes(c[0]))).toBe(false);
    expect(services.write.mock.calls[0][1].roleAnalysis).toEqual(persisted!.use_roles);
  });
  it("缓存身份包含编译、模型、知识版本，重试不重做P1",async()=>{
    await interpretRoute(request());await interpretRoute(request({chart_id:cid,retry:true}));
    const key=services.cache.mock.calls[0][1];
    expect(key.pipeline_version).toBe("analysis-planner-v4.1-pr4");
    expect(key.compilation_hash).toMatch(/^[a-f0-9]{64}$/);expect(key.versions.model_profile).toBe("test-model-profile");
    expect(key.retrieval_identity.embedding_profile).toBe("profile-v1");
    expect(services.roles).toHaveBeenCalledTimes(1);expect(services.model).toHaveBeenCalledTimes(1);
  });
  it("语义冲突不降级旧取用或检索",async()=>{
    record.question_analysis={...record.question_analysis!,status:"semantic_conflict",issue_count:2};
    const body=await (await interpretRoute(request())).json();
    expect(body.result.planner_status.status).toBe("semantic_conflict");
    expect(services.write).not.toHaveBeenCalled();expect(services.roles).not.toHaveBeenCalled();
    expect(services.call.mock.calls.some(c=>c[0].startsWith("source-"))).toBe(false);
  });
  it("返回资料换盘或换知识版本时拒绝写作，不自动重检或回退V1",async()=>{
    const original=services.call.getMockImplementation()!;
    services.call.mockImplementation(async(path:string,body:Record<string,unknown>)=>{
      const result=await original(path,body);
      if(path==="source-evidence-round")result.hybrid_evidence.retrieval_identity={knowledge_release_id:"changed"};
      return result;
    });
    expect((await interpretRoute(request())).status).toBe(502);
    expect(services.write).not.toHaveBeenCalled();
    expect(services.call.mock.calls.filter(c=>c[0]==="source-evidence-round")).toHaveLength(1);
    expect(services.call.mock.calls.some(c=>c[0]==="source-evidence")).toBe(false);
  });
  it("同一冻结盘 V1与V4查询不同，编译结果稳定且不混入日月地支",async()=>{
    await planRoute(request());const p=persisted!;
    const compiled=compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis);
    expect(compiled).toEqual(compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis));
    expect(compiled.queries.map(q=>q.query).join(" ")).not.toMatch(/酉化申|辰月|准备不足|能找到工作吗/);
    expect(compiled.task_log).toHaveLength(p.initial_plan.tasks.length);
    expect(p.initial_plan.tasks).toEqual(persisted!.initial_plan.tasks);
  });
  it("拒绝越界task/fact/topic/关键词，不执行自由query",async()=>{
    await planRoute(request());const p=persisted!,draft=initialRetrievalRequests(p.initial_plan);
    for(const patch of [{parent_task_id:"fake"},{fact_refs:["fake"]},{topic_ids:["fake"]},{keyword_terms:["DROP TABLE"]},{target_type:"all"},{priority:"invented"},{query:"自由拼接"}]){
      expect(()=>compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis,[{...draft[0],...patch}] as typeof draft)).toThrow();
    }
    expect(()=>compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis,[draft[0],draft[0]])).toThrow();
  });
  it("允许零case；可显式请求事件case但不能用升迁代替求职",async()=>{
    await planRoute(request());const p=persisted!,draft=initialRetrievalRequests(p.initial_plan);
    const caseRequest={...draft[0],target_type:"case" as const,keyword_terms:["求职","求官"]};
    expect(compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis,[caseRequest]).queries[0].query).toBe("求职 求官");
    expect(()=>compileRetrievalRequests(p.initial_plan,p.fact_catalog,p.question_analysis,[{...caseRequest,keyword_terms:["升迁"]}])).toThrow("QUERY_TERM_INVALID");
  });
  it("超出预算明确记录deferred而非覆盖，保留全部初始任务",async()=>{
    await planRoute(request());const p=persisted!;
    const tasks=Array.from({length:7},(_,i)=>({...p.initial_plan.tasks[0],task_id:`t${i}`,priority:i===6?"critical" as const:"high" as const}));
    const plan={...p.initial_plan,tasks};const compiled=compileRetrievalRequests(plan,p.fact_catalog,p.question_analysis);
    expect(compiled.queries).toHaveLength(5);expect(compiled.queries[0].parent_task_id).toBe("t6");
    expect(compiled.task_log.filter(t=>t.status==="budget_deferred")).toHaveLength(2);
    expect(compiled.warnings).toContain("FIRST_ROUND_TASKS_DEFERRED");expect(tasks).toHaveLength(7);
  });
});

describe("PR-3 冻结盘规划接口",()=>{
  it("确定性模式不调用P1模型，并可复验缓存",async()=>{
    vi.stubEnv("LIUYAO_PLANNER_MODE","deterministic");
    services.model.mockRejectedValue(new Error("P1_MUST_NOT_CALL"));
    const first=(await (await planRoute(request())).json()).result;
    expect(first.status).toBe("ready");expect(first.initial_plan.status).toBe("generated");
    expect(first.initial_plan.generation_mode).toBe("deterministic");
    const second=(await (await planRoute(request())).json()).result;
    expect(second).toEqual(first);expect(services.model).not.toHaveBeenCalled();
    expect(services.roles).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["能找到工作吗","career","new_job","officials","career"],
    ["我与前任能复合吗","relationship","reconciliation","response","response"],
    ["我作为男方问女方今年能否结婚","relationship","marriage","wealth","marriage-woman"],
    ["借出去的钱能否收回","finance","debt_repayment","wealth","wealth"],
  ])("%s 可以输出受控初始计划",async(question,domain,event,role,rule)=>{
    setup(question,domain,event,role,rule);
    const response=await planRoute(request()),body=await response.json();
    expect(response.status).toBe(200);expect(body.result.status).toBe("ready");
    expect(body.result.initial_plan.status).toBe("generated");expect(body.result.initial_plan.tasks.length).toBeLessThanOrEqual(7);
    expect(services.model).toHaveBeenCalledTimes(1);expect(services.roles).toHaveBeenCalledTimes(1);
    expect(services.roles.mock.calls[0][4].event_type).toBe(event);
    expect(services.call.mock.calls.some(c=>["cast","source-evidence","query"].includes(c[0]))).toBe(false);
  });
  it("重复读取初始快照，不再次取用或规划",async()=>{
    const first=(await (await planRoute(request())).json()).result;
    const second=(await (await planRoute(request())).json()).result;
    expect(second).toEqual(first);expect(services.roles).toHaveBeenCalledTimes(1);expect(services.model).toHaveBeenCalledTimes(1);
    expect(services.call.mock.calls.filter(c=>c[0]==="analysis-plan").every(c=>c[2]===true)).toBe(true);
  });
  it("损坏的缓存事实不能冒充当前盘面进入后续分析",async()=>{
    await planRoute(request());
    persisted=structuredClone(persisted!);persisted.fact_catalog.facts[0].subject_ref="main:99";
    const response=await planRoute(request());expect(response.status).toBe(502);expect(services.roles).toHaveBeenCalledTimes(1);
  });
  it("并发请求共享一次规划",async()=>{
    const results=await Promise.all([planRoute(request()),planRoute(request())]);
    expect((await results[0].json()).result).toEqual((await results[1].json()).result);
    expect(services.roles).toHaveBeenCalledTimes(1);expect(services.model).toHaveBeenCalledTimes(1);
  });
  it("已冻结Q1语义冲突时停止，原盘和问题不变",async()=>{
    const before=JSON.stringify(record.cast);record.question_analysis={...record.question_analysis!,status:"semantic_conflict",issue_count:2};
    const body=await (await planRoute(request())).json();
    expect(body.result.status).toBe("semantic_conflict");expect(JSON.stringify(record.cast)).toBe(before);
    expect(services.roles).not.toHaveBeenCalled();expect(services.model).not.toHaveBeenCalled();expect(persisted).toBeNull();
  });
  it("错误取用分支不被taxonomy自动改写",async()=>{
    setup("能找到工作吗","career","new_job","wealth","wealth");
    const body=await (await planRoute(request())).json();expect(body.result.status).toBe("unsupported");expect(body.result.reason_code).toBe("USE_RULE_EVENT_MISMATCH");
    expect(services.model).not.toHaveBeenCalled();expect(persisted).toBeNull();
  });
  it("求职缺少必要的世爻角色时阻止规划，不静默补角色",async()=>{
    services.roles.mockResolvedValue(validateUseRoles(JSON.stringify({primary:{role:"officials",rule_id:"career",meaning:"职位",reason:"求职"},auxiliary:[],missing_information:[],uncertainties:[]}),core,"chart-hash"));
    const body=await (await planRoute(request())).json();expect(body.result.status).toBe("unsupported");expect(services.model).not.toHaveBeenCalled();
  });
  it("规划模型两次失败后保存安全最小计划",async()=>{
    services.model.mockResolvedValue("bad-json");
    const body=await (await planRoute(request())).json();
    expect(body.result.initial_plan.status).toBe("fallback");expect(services.model).toHaveBeenCalledTimes(2);expect(persisted).not.toBeNull();
  });
  it("未确认、换问、换hash不进入规划",async()=>{
    expect((await planRoute(request({chart_id:cid,question:"换问"}))).status).toBe(422);expect(services.call).not.toHaveBeenCalled();
    expect((await planRoute(request({chart_id:cid,chart_hash:"changed"}))).status).toBe(409);expect(services.roles).not.toHaveBeenCalled();
    record.confirmation_status="legacy_unconfirmed";expect((await planRoute(request())).status).toBe(409);
  });
});

 describe("Chinese retrieval for English questions",()=>{
  it("translates the event before DB retrieval without changing the frozen question",async()=>{
    const original="Will my trip to Shanghai next month go smoothly?";
    setup(original);
    services.model.mockImplementation(async(_system:string,input:Record<string,unknown>)=>{
      if(input.original_question)return JSON.stringify({question_zh:"下个月去上海的行程会顺利吗？"});
      return JSON.stringify({tasks:minimumAnalysisPlan(input.fact_catalog as FactCatalog,input.question_analysis as SingleQuestionAnalysis,"question-hash","TEST").tasks});
    });
    const response=await interpretRoute(request());expect(response.status).toBe(200);
    const retrieval=services.call.mock.calls.find(([path])=>path==="source-evidence-round");
    expect(retrieval).toBeDefined();
    expect(retrieval![1].queries.every((q:string)=>q.includes("下个月去上海的行程会顺利吗？")&&!q.includes(original))).toBe(true);
    expect(record.question).toBe(original);expect(record.confirmed_question?.normalized_question).toBe(original);
    expect(record.cast.question_hash).toBe("question-hash");
  });
});
