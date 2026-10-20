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
  it("does not retry timeout or salvage invalid output into fallback",async()=>{
    const model=vi.fn().mockRejectedValue(new Error("WORKFLOW_NODE_TIMEOUT"));
    const r=await synthesizeStructuredReasoning(context(),model,async()=>{});expect(r.status).toBe("failed");expect(r.value).toBeUndefined();expect(model).toHaveBeenCalledTimes(1);
    const bad=vi.fn().mockResolvedValue(JSON.stringify({...draft(),explainer:{}}));
    const failed=await synthesizeStructuredReasoning(context(),bad,async()=>{});expect(failed.status).toBe("failed");expect(failed.value).toBeUndefined();
  });
});
