import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { FrozenQuestionRecord, LiuyaoCoreFacts } from "../lib/contracts/divination";
import { resolveReviewedUseRoles } from "../lib/divination/deterministic-use-roles";
import { extractAnalysisFacts } from "../lib/divination/analysis-facts";
import { minimumAnalysisPlan } from "../lib/divination/analysis-plan";
import { reasoningFixture, reasoningDraft } from "./fixtures/reasoning-fixture";
import { buildReasoningInput } from "../lib/divination/reasoning-input";
import { compileReasoningOutput, salvageReasoningOutput } from "../lib/divination/reasoning-output";
import { synthesizeStructuredReasoning, writeReasoningText } from "../lib/server/structured-reasoning-llm";
import { classifyReasoningFailure, type ReasoningRunDiagnostic } from "../lib/server/reasoning-diagnostics";
import { runReasoningStage } from "../lib/server/reasoning-stage";
import { boundedWorkflow, workflowRemaining } from "../lib/server/workflow-budget";
import { assertFactClaimDirections, assertNoUnverifiedDerivation } from "../lib/divination/fact-claim-guard";
import { validateReasoningContext } from "../lib/divination/structured-reasoning";
import { lightweightExplainerDraft as explainerDraft } from "./fixtures/explainer-fixture";

beforeEach(()=>vi.stubEnv("LIUYAO_REASONING_MODE","strict"));
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
const compact=(c=reasoningFixture())=>{
  const b=buildReasoningInput(c);
  return {findings:b.input.allowed_tasks.map(t=>({task_id:t.task_id,fact_refs:t.fact_refs,evidence_ids:b.input.evidence.filter(e=>e.task_ids.includes(t.parent_task_id)).map(e=>e.evidence_id),status:"conditional",interpretation:"此处仅可作条件对照，不足以确定现实结果。",limitations:["须核验原文条件。"]})),synthesis:{status:"conditional",conclusion:"仅可作有条件解释。",limitations:["不作现实结果预测。"]},explainer:explainerDraft(b.input)};
};
function frozenFixture(){
  const c=reasoningFixture(),core=JSON.parse(readFileSync(new URL("../docs/examples/liuyao-245-core.json",import.meta.url),"utf8")) as LiuyaoCoreFacts;
  c.planner.question_analysis={...c.planner.question_analysis,domain:"career",event_type:"new_job",subject_actor_id:"querent",actors:[{id:"querent",label:"我",role:"querent",evidence:{source_id:"question",start:0,end:1,text:"我"}}]};
  c.planner.use_roles=resolveReviewedUseRoles(core,c.planner.chart_hash,c.planner.question_analysis).analysis!;
  c.planner.fact_catalog=extractAnalysisFacts(core,c.planner.use_roles,c.planner.chart_hash);
  c.planner.initial_plan=minimumAnalysisPlan(c.planner.fact_catalog,c.planner.question_analysis,c.planner.question_hash,"TEST");
  c.frozen={question:c.question,confirmation_status:"confirmed",cast:{chart_id:c.planner.chart_id,chart_hash:c.planner.chart_hash,core_facts:core} as FrozenQuestionRecord["cast"],
    confirmed_question:{version:"confirmed-question-v1",confirmation_id:c.planner.confirmation_id,question_hash:c.planner.question_hash,normalized_question:c.question,numbers:[2,4,5],timezone:"Asia/Hong_Kong",confirmed_at:"2026-10-15T00:00:00Z",source:"explicit_user_action",state:"confirmed",
      context:{initiator:null,number_provider:null,perspective_person:null,target_entities:[],relationships:[],known_facts:[],process_stage:null,time_expression:null,exclusions:[]}}};
  return c;
}
describe("PR6 production input, compact output and invariants",()=>{
  it("shares verified frozen calendar and role views without treating local labels as overall strength",()=>{
    const c=frozenFixture(),b=buildReasoningInput(c);
    expect(b.input.calendar_context?.fields).toEqual(c.frozen!.cast.core_facts!.calendar);
    expect(b.input.analysis_core_view?.status).toBe("core_verified");
    expect(b.input.analysis_core_view?.primary[0].line_ref).toBe("main:5");
    expect(b.input.analysis_core_view?.self[0].line_ref).toBe("main:3");
    expect(b.input.analysis_core_view?.self[0].states.month_break.value).toBe(true);
    expect(b.input.interpretation_boundary.rule_application).toContain("仍需适用依据");
    expect(b.input).not.toHaveProperty("messages");
  });
  it("re-derives facts/roles from frozen core and rejects tampering despite matching chart hash",()=>{
    const c=frozenFixture();expect(()=>validateReasoningContext(c)).not.toThrow();
    const badRole=structuredClone(c);badRole.planner.use_roles.primary!.main_line_refs=["main:3"];expect(()=>validateReasoningContext(badRole)).toThrow();
    const badFact=structuredClone(c);const f=badFact.planner.fact_catalog.facts.find(f=>f.subject_ref==="main:3"&&f.object_ref==="main:5")!;
    (f.value as {element_relation:string}).element_relation="controls";expect(()=>validateReasoningContext(badFact)).toThrow("REASONING_FROZEN_FACTS_CHANGED");
  });
  it("keeps relevant confirmed background and exclusions but not full dialogue",()=>{
    const c=frozenFixture(),ctx=c.frozen!.confirmed_question!.context;
    ctx.known_facts=[{value:"已提交申请",provenance:"user_explicit",verification_status:"confirmed"}];ctx.exclusions=["不分析薪资"];
    const b=buildReasoningInput(c);expect(b.input.confirmed_question.context?.known_facts).toEqual(ctx.known_facts);expect(b.input.confirmed_question.context?.exclusions).toEqual(ctx.exclusions);
    expect(b.input).not.toHaveProperty("messages");
  });
  it("omits history/scores/duplicate question analysis, preserves complete text and provenance",()=>{
    const c=reasoningFixture(),b=buildReasoningInput(c);
    expect(b.input).not.toHaveProperty("retrieval_history");expect(b.input).not.toHaveProperty("question_analysis");expect(b.input).not.toHaveProperty("fact_observations");
    for(const [i,e] of b.input.evidence.entries()){
      expect(e.text).toBe(c.agent.snapshot.evidence[i].text);expect(e.provenance.quote_hash).toBe(c.agent.snapshot.evidence[i].quote_hash);expect(e.provenance.origins).toEqual(c.agent.snapshot.evidence[i].origins);
    }
    expect(b.input.allowed_tasks[0].required_evidence_ids).toEqual(["E1","E2"]);
  });
  it("six-field finding compiles to compatible public V1 with program observation and gaps",()=>{
    const c=reasoningFixture(),b=buildReasoningInput(c),r=compileReasoningOutput(compact(c),c,b);
    expect(r.version).toBe("structured-reasoning-v1");expect(r.findings[0].fact_refs).toEqual(["F1"]);expect(r.findings[0].evidence_ids).toEqual(c.agent.snapshot.evidence.map(e=>e.evidence_id));
    expect(r.findings[0].observation).toBe(reasoningDraft(c).findings[0].observation);
  });
  it.each(["task_id","fact_refs","evidence_ids"] as const)("rejects invented %s with field-level path",field=>{
    const c=reasoningFixture(),raw=compact(c);Object.assign(raw.findings[0],{[field]:field==="task_id"?"UNKNOWN":["UNKNOWN"]});
    try{compileReasoningOutput(raw,c,buildReasoningInput(c));throw new Error("expected rejection");}catch(error){expect(error).toHaveProperty("issues.0.path",expect.stringContaining(`findings[0].${field}`));}
  });
  it("refuses model-owned roles, observations or a foreign catalog hash",()=>{
    const c=reasoningFixture(),raw=compact(c),b=buildReasoningInput(c);
    expect(()=>compileReasoningOutput({...raw,use_roles:{primary:"wealth"}},c,b)).toThrow();
    expect(()=>compileReasoningOutput({...raw,findings:[{...raw.findings[0],observation:"官鬼生世"}]},c,b)).toThrow();
    c.planner.fact_catalog={...c.planner.fact_catalog,chart_hash:"foreign"};expect(()=>validateReasoningContext(c)).toThrow();
  });
  it("canonical main:3 土 generates main:5 金 cannot be reversed by free text",()=>{
    const c=reasoningFixture();c.planner.fact_catalog.facts.push(
      {fact_id:"RS",type:"role_binding",subject_ref:"main:3",value:{role:"self",priority:"auxiliary"},source:"derived_verified"},
      {fact_id:"RO",type:"role_binding",subject_ref:"main:5",value:{role:"officials",priority:"primary"},source:"derived_verified"},
      {fact_id:"REL",type:"line_relationship",subject_ref:"main:3",object_ref:"main:5",value:{element_relation:"generates",source_element:"土",target_element:"金"},source:"derived_verified"},
      {fact_id:"REV",type:"line_relationship",subject_ref:"main:5",object_ref:"main:3",value:{element_relation:"generated_by",source_element:"金",target_element:"土"},source:"derived_verified"});
    expect(()=>assertFactClaimDirections("世爻生官鬼",c.planner.fact_catalog)).not.toThrow();
    expect(()=>assertFactClaimDirections("官鬼生世爻",c.planner.fact_catalog)).toThrow("REASONING_RELATION_DIRECTION_INVALID");
    expect(()=>assertFactClaimDirections("main:5生main:3",c.planner.fact_catalog)).toThrow();
    expect(()=>assertFactClaimDirections("用神改取妻财",c.planner.fact_catalog)).toThrow("REASONING_USE_ROLE_CHANGED");
    expect(()=>assertFactClaimDirections("以妻财为用神",c.planner.fact_catalog)).toThrow("REASONING_USE_ROLE_CHANGED");
    expect(()=>assertFactClaimDirections("以官鬼为用神",c.planner.fact_catalog)).not.toThrow();
    expect(()=>assertFactClaimDirections("原文侧重用神生世，对世生用的吉凶判定需结合用神最终旺衰。",c.planner.fact_catalog)).not.toThrow();
    expect(()=>assertFactClaimDirections("原文讲用神生世；当前官鬼生世爻。",c.planner.fact_catalog)).toThrow();
    expect(()=>assertFactClaimDirections("若官鬼生世爻，须核验条件。当前世爻生官鬼。",c.planner.fact_catalog)).not.toThrow();
  });
  it("a definition query cannot become an established advance/retreat claim",()=>{
    expect(()=>assertNoUnverifiedDerivation("程序未判定进退神，且缺乏具体规则支持当前变化构成化退或化进，故无法断言其吉凶含义。")).not.toThrow();
    expect(()=>assertNoUnverifiedDerivation("缺乏具体规则支持当前变化构成化退或化进但用神已经化退。")).toThrow("REASONING_FACT_CLAIM_INVALID");
    expect(()=>assertNoUnverifiedDerivation("缺乏规则支持但官鬼已经化退。")).toThrow("REASONING_FACT_CLAIM_INVALID");
    expect(()=>assertNoUnverifiedDerivation("官鬼发动但化退，事业将由盛转衰。")).toThrow("REASONING_FACT_CLAIM_INVALID");
    expect(()=>assertNoUnverifiedDerivation("是否构成退神尚待核验，不能据此断定现实结果。")).not.toThrow();
    expect(()=>assertNoUnverifiedDerivation("涉及进退神判定。因程序未判定进退神，此处仅确认发动。具体是化进还是化退尚待核验定义规则。")).not.toThrow();
    expect(()=>assertNoUnverifiedDerivation("同五行地支顺序后退可能构成退神。但程序未判定进退神成立，是否存在退神趋势尚待核验。")).not.toThrow();
    expect(()=>assertNoUnverifiedDerivation("原文定义进退神为爻之动而化，喜宜化进，忌宜化退。当前是否构成退神尚待核验。")).not.toThrow();
    const c=reasoningFixture(),raw=compact(c);raw.synthesis.conclusion="用神化退，求职困难。";
    expect(()=>compileReasoningOutput(raw,c,buildReasoningInput(c))).toThrow("REASONING_FACT_CLAIM_INVALID");
  });
  it("evidence from the wrong task is rejected even if in snapshot",()=>{
    const c=reasoningFixture(),b=buildReasoningInput(c),raw=compact(c);
    c.planner.initial_plan.tasks.push({...c.planner.initial_plan.tasks[0],task_id:"T2"});raw.findings[0].task_id="T2";
    expect(()=>compileReasoningOutput(raw,c,b)).toThrow("REASONING_EVIDENCE_INVALID");
  });
  it("cannot elevate unknown facts or case-only support to supported",()=>{
    const c=reasoningFixture(),raw=compact(c);c.planner.fact_catalog.facts[0].value=null;raw.findings[0].status="supported";
    expect(()=>compileReasoningOutput(raw,c,buildReasoningInput(c))).toThrow("REASONING_UNSUPPORTED_STRENGTH");
  });
  it("salvages only valid findings and never emits final prediction",async()=>{
    const c=reasoningFixture(),raw=compact(c);raw.findings.push({...raw.findings[0],task_id:"UNKNOWN",interpretation:"BAD_UNVERIFIED_TEXT"});
    const partial=salvageReasoningOutput(raw,c,buildReasoningInput(c))!;
    expect(partial.findings).toHaveLength(1);expect(partial.overall_assessment.conclusion).toBeNull();
    const save=vi.fn(async()=>{}),write=vi.fn();
    const result=await runReasoningStage("test",c,async()=>{}, {store:{load:async()=>null,save},synthesize:async()=>({status:"partial",value:partial,attempts:2,code:"REASONING_TASK_INVALID"}),write});
    expect(result.status).toBe("partial");expect(result.modern?.overall_interpretation).toContain("部分分析");expect(result.modern?.overall_interpretation).not.toContain("BAD_UNVERIFIED_TEXT");expect(write).not.toHaveBeenCalled();
    expect(salvageReasoningOutput({findings:[{...raw.findings[0],task_id:"UNKNOWN"}]},c,buildReasoningInput(c))).toBeUndefined();
  });
  it("deterministic final text contains only validated interpretation",async()=>{
    const c=reasoningFixture(),r=compileReasoningOutput(compact(c),c,buildReasoningInput(c)),result=await writeReasoningText(r);
    expect(result.attempts).toBe(0);expect(result.value?.paragraphs).toEqual([]);expect(result.value?.report_hash).toBeTruthy();
  });
});
describe("PR6 production retry, diagnostics and budgets",()=>{
  it("inner deadline really reduces remaining budget",async()=>{
    await boundedWorkflow(1000,async()=>{expect(workflowRemaining()).toBeLessThanOrEqual(1000);await boundedWorkflow(100,async()=>expect(workflowRemaining()).toBeLessThanOrEqual(100));});
  });
  it("timeout is diagnosed once, without repeating the request",async()=>{
    const model=vi.fn().mockRejectedValue(new DOMException("provider deadline","TimeoutError")),runs:ReasoningRunDiagnostic[]=[];
    const result=await synthesizeStructuredReasoning(reasoningFixture(),model,async r=>{runs.push(r);});
    expect(result.status).toBe("failed");expect(result.failure_kind).toBe("timeout");expect(model).toHaveBeenCalledTimes(1);expect(runs[0].attempts[0].outcome).toBe("timeout");
  });
  it("invalid JSON and references get one repair with original draft, usage and exact issue",async()=>{
    const c=reasoningFixture(),raw=compact(c);raw.findings[0].evidence_ids=["BAD"];
    const model=vi.fn().mockResolvedValueOnce(JSON.stringify(raw)).mockImplementationOnce(async(_p,_input,_repair,opts)=>{opts.onMetadata({model:"test-provider-model",finish_reason:"stop",input_tokens:10,output_tokens:20,request_timeout_ms:100});return JSON.stringify(compact(c));});
    const runs:ReasoningRunDiagnostic[]=[];const result=await synthesizeStructuredReasoning(c,model,async r=>{runs.push(r);});
    expect(result.status).toBe("ready");expect(model).toHaveBeenCalledTimes(2);expect(model.mock.calls[1][1].repair).toMatchObject({previous_output:JSON.stringify(raw),issues:[{path:"findings[0].evidence_ids[0]"}]});
    expect(runs[1].attempts[1]).toMatchObject({model:"test-provider-model",input_tokens:10,output_tokens:20,finish_reason:"stop",outcome:"accepted"});
    expect(runs[1].attempts[1].output_chars).toBeGreaterThan(0);expect(JSON.stringify(result)).not.toContain("raw_output");
    const jsonModel=vi.fn().mockResolvedValueOnce("bad").mockResolvedValueOnce(JSON.stringify(compact(c)));
    expect((await synthesizeStructuredReasoning(c,jsonModel,async()=>{})).status).toBe("ready");
  });
  it.each([
    [new SyntaxError("bad JSON"),"invalid_json"],
    [new Error("REASONING_SCHEMA_INVALID"),"schema_invalid"],
    [new Error("REASONING_FACT_INVALID"),"invalid_reference"],
    [new Error("REASONING_EVIDENCE_REQUIRED"),"insufficient_evidence"],
    [new Error("WORKFLOW_NODE_TIMEOUT"),"timeout"],
  ])("failure classes are distinct (%s)",(error,kind)=>expect(classifyReasoningFailure(error)).toBe(kind));
  it("no audit persistence means no unaudited generated output",async()=>{
    const c=reasoningFixture(),result=await synthesizeStructuredReasoning(c,async()=>JSON.stringify(compact(c)),async()=>{throw new Error("disk full");});
    expect(result.status).toBe("failed");expect(result.code).toBe("REASONING_DIAGNOSTIC_WRITE_FAILED");expect(result.value).toBeUndefined();
  });
});
