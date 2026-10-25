import { emptyEvidenceSnapshot, mergeEvidence } from "../lib/divination/evidence-accumulator";
import {afterEach,describe,it,expect,vi} from "vitest";
import {reasoningFixture} from "./fixtures/reasoning-fixture";
import {buildReasoningInput} from "../lib/divination/reasoning-input";
import {compileReasoningOutput} from "../lib/divination/reasoning-output";
import {validateStructuredReasoning} from "../lib/divination/structured-reasoning";
import {synthesizeStructuredReasoning,writeReasoningText} from "../lib/server/structured-reasoning-llm";
import {reasoningMode} from "../lib/server/reasoning-config";
import {reasoningCheckpointKey} from "../lib/server/reasoning-stage";
import {FULL_GENERATION_PROMPT,EXPLAINER_REASONING_PROMPT} from "../lib/divination/explainer-prompt";
import {renderReasoningText,reasoningTextTemplate} from "../lib/divination/reasoning-text";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import InterpretationPanel from "../app/divination/interpretation-panel";
import type {DivinationInterpretationResult} from "../lib/contracts/divination";

afterEach(()=>vi.unstubAllEnvs());
const context=()=>({...reasoningFixture(),validation_mode:"integrity" as const});
function draft(){return {findings:[{task_id:"T1",evidence_ids:["E1"],status:"supported",interpretation:"月破与旺的关系由模型解释，不经过程序语义审查。",conditions:["综合条件未知"],limitations:[]}],
  synthesis:{status:"supported",conclusion:"模型完整结论",limitations:[]},explainer:{sections:{
    verdict:[{text:"三个月内有求职机会，但不保证结果。",evidence_ids:["E1"]}],
    advice:[{text:"持续投递并记录面试反馈。",evidence_ids:[],practical:true}],
    analysis:[{text:"此处由模型判断原文的适用性，不等程序核定。",evidence_ids:["E1"]}]},limitations:[]}};}
describe("Full generation: integrity only, explicit semantic boundary",()=>{
  it("reports exact cross-task citation and repairs it without semantic checks",async()=>{
    const c=context();
    c.planner.initial_plan.tasks.push({...c.planner.initial_plan.tasks[0],task_id:"T2"});
    const history=structuredClone(c.agent.snapshot.retrieval_history);
    history[1].requests[0].parent_task_id="T2";
    history[1].pack.retrieval_trace![0].parent_task_id="T2";
    c.agent.snapshot=history.reduce((snapshot,round)=>mergeEvidence(snapshot,round),emptyEvidenceSnapshot(c.planner.chart_hash,c.planner.question_hash,c.identity));
    const built=buildReasoningInput(c);
    expect(built.input.allowed_tasks.find(t=>t.task_id==="T1")?.allowed_evidence_ids).toEqual(["E1"]);
    const bad=draft();bad.findings[0].evidence_ids=["E2"];
    const model=vi.fn().mockImplementationOnce(async()=>JSON.stringify(bad)).mockImplementationOnce(async(_prompt,input)=>{
      expect(input.repair.issues).toMatchObject([{code:"REASONING_EVIDENCE_INVALID",path:"findings[0].evidence_ids[0]",received:"E2",expected:{allowed_evidence_ids:["E1"],parent_task_ids:["T1"]}}]);
      return JSON.stringify(draft());
    });
    const result=await synthesizeStructuredReasoning(c,model,async()=>{});
    expect(result.status).toBe("ready");expect(result.attempts).toBe(2);
    expect(result.value?.findings[0].interpretation).toBe(draft().findings[0].interpretation);
  });
  it("retries a failed repair connection with the same draft and all citation errors",async()=>{
    const bad=draft();bad.findings[0].evidence_ids=["E999","E998"];
    const model=vi.fn().mockResolvedValueOnce(JSON.stringify(bad)).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(JSON.stringify(draft()));
    const result=await synthesizeStructuredReasoning(context(),model,async()=>{});
    expect(result.status).toBe("ready");expect(result.attempts).toBe(3);
    const repair=model.mock.calls[1][1].repair;
    expect(repair.issues.map((i:{received:string})=>i.received)).toEqual(["E999","E998"]);
    expect(model.mock.calls[2][1]).toEqual(model.mock.calls[1][1]);
    expect(model.mock.calls[2][2]).toEqual(model.mock.calls[1][2]);
  });
  it("bounds transport retries and does not retry authentication failures",async()=>{
    const network=vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect((await synthesizeStructuredReasoning(context(),network,async()=>{})).status).toBe("failed");
    expect(network).toHaveBeenCalledTimes(3);
    const auth=vi.fn().mockRejectedValue(new Error("PLANNER_HTTP_401"));
    await synthesizeStructuredReasoning(context(),auth,async()=>{});expect(auth).toHaveBeenCalledTimes(1);
  });
  it("keeps the confirmed identity and supplies a separate Chinese research question",()=>{
    const c=context();c.research_question_zh="未来三个月能找到工作吗？";
    const built=buildReasoningInput(c);
    expect(built.input.research_question_zh).toBe(c.research_question_zh);
    expect(built.input.confirmed_question.normalized_question).toBe(c.question);
    expect(reasoningCheckpointKey(c)).not.toBe(reasoningCheckpointKey({...c,research_question_zh:undefined}));
  });
  it("prompts request two sections; omitted advice compiles and renders without placeholders",()=>{
    for(const prompt of [FULL_GENERATION_PROMPT,EXPLAINER_REASONING_PROMPT]){
      expect(prompt).not.toContain('"advice"');expect(prompt).not.toContain("行动建议");
    }
    const c=context(),d=draft(),{advice,...sections}=d.explainer.sections;void advice;
    const r=compileReasoningOutput({...d,explainer:{...d.explainer,sections}},c,buildReasoningInput(c),true);
    expect(r.explainer?.sections.advice).toEqual([]);
    const modern=renderReasoningText(reasoningTextTemplate(r),r);
    expect(modern.overall_interpretation).toContain("断语");expect(modern.overall_interpretation).toContain("卦理分析");
    expect(modern.overall_interpretation).not.toContain("行动建议");
    const result={modern_interpretation:modern,structured_reasoning:r,analysis_status:"complete",evidence_pack:{primary:{name:"测试"},transformed:{name:"测试"},moving_lines:[],evidence:[],sources:[]}} as unknown as DivinationInterpretationResult;
    const html=renderToStaticMarkup(createElement(InterpretationPanel,{result}));
    expect(html).not.toContain("行动建议");expect(html).not.toContain("暂无具备");
    expect(()=>validateStructuredReasoning(r,c)).not.toThrow();
  });
  it("defaults full, rejects typos, isolates strict cache",()=>{
    vi.stubEnv("LIUYAO_REASONING_MODE","");expect(()=>reasoningMode()).toThrow();
    vi.stubEnv("LIUYAO_REASONING_MODE","full");const key=reasoningCheckpointKey(context());
    vi.stubEnv("LIUYAO_REASONING_MODE","strict");expect(reasoningCheckpointKey({...context(),validation_mode:"strict"})).not.toBe(key);
    vi.stubEnv("LIUYAO_REASONING_MODE",undefined);expect(reasoningMode()).toBe("full");
  });
  it("retains complete model prose without applicability or strength gates",()=>{
    const c=context(),b=buildReasoningInput(c),r=compileReasoningOutput(draft(),c,b,true);
    expect(r.overall_assessment.status).toBe("supported");expect(r.explainer?.validation_mode).toBe("integrity");
    expect(r.explainer?.claims[2].text).toBe(draft().explainer.sections.analysis[0].text);
    expect(r.explainer?.claims.every(c=>c.rule_application===null)).toBe(true);
    expect(validateStructuredReasoning(r,c)).toEqual(r);
    expect(b.input.allowed_tasks[0].required_evidence_ids).toEqual([]);
  });
  it.each(["fact_refs","evidence_ids","task_id"])("still rejects invented %s",field=>{
    const c=context(),d=draft() as unknown as {findings:Record<string,unknown>[]};
    d.findings[0][field]=field==="task_id"?"foreign":["foreign"];
    expect(()=>compileReasoningOutput(d,c,buildReasoningInput(c),true)).toThrow();
  });
  it("rejects mutation of frozen identity, observations and source citations",()=>{
    const c=context(),r=compileReasoningOutput(draft(),c,buildReasoningInput(c),true);
    for(const mutate of [(v:typeof r)=>{v.chart_hash="foreign";},(v:typeof r)=>{v.findings[0].observation="invented";},(v:typeof r)=>{v.explainer!.citations[0].quote="invented";}]){
      const copy=structuredClone(r);mutate(copy);expect(()=>validateStructuredReasoning(copy,c)).toThrow();
    }
    expect(()=>compileReasoningOutput({...draft(),use_roles:{}},c,buildReasoningInput(c),true)).toThrow();
  });
  it("rejects current-snapshot evidence owned by another task",()=>{
    const c=context();c.agent.snapshot=structuredClone(c.agent.snapshot);
    c.agent.snapshot.evidence[0].task_ids=["other-task"];
    expect(()=>compileReasoningOutput(draft(),c,buildReasoningInput(c),true)).toThrow();
  });
  it("retains strict rollback rather than silently weakening its validator",()=>{
    const c=context(),r=compileReasoningOutput(draft(),c,buildReasoningInput(c),true);
    expect(()=>validateStructuredReasoning(r,{...c,validation_mode:"strict"})).toThrow();
  });
  it("keeps unreviewed tasks visible instead of replacing prose",()=>{
    const c=context(),d=draft();d.findings=[];const r=compileReasoningOutput(d,c,buildReasoningInput(c),true);
    expect(r.unreviewed_task_ids).toEqual(["T1"]);expect(r.explainer?.generation_mode).toBe("model");
  });
  it("repairs JSON once and renders without a second writer model",async()=>{
    const c=context(),model=vi.fn().mockResolvedValueOnce("bad").mockResolvedValueOnce(JSON.stringify(draft()));
    const result=await synthesizeStructuredReasoning(c,model,async()=>{});expect(result.status).toBe("ready");expect(model).toHaveBeenCalledTimes(2);
    const writer=vi.fn();expect((await writeReasoningText(result.value!,writer)).status).toBe("ready");expect(writer).not.toHaveBeenCalled();
  });
  it("bounds timeout retries and never salvages invalid output into fallback",async()=>{
    const model=vi.fn().mockRejectedValue(new Error("WORKFLOW_NODE_TIMEOUT"));
    const r=await synthesizeStructuredReasoning(context(),model,async()=>{});expect(r.status).toBe("failed");expect(r.value).toBeUndefined();expect(model).toHaveBeenCalledTimes(3);
    const bad=vi.fn().mockResolvedValue(JSON.stringify({...draft(),explainer:{}}));
    const failed=await synthesizeStructuredReasoning(context(),bad,async()=>{});expect(failed.status).toBe("failed");expect(failed.value).toBeUndefined();
  });
});
