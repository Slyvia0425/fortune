import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateStructuredReasoning, validateReasoningContext, findingObservation, requiredUnresolved } from "../lib/divination/structured-reasoning";
import { validateReasoningText, reasoningTextTemplate, renderReasoningText } from "../lib/divination/reasoning-text";
import { synthesizeStructuredReasoning, writeReasoningText } from "../lib/server/structured-reasoning-llm";
import { buildReasoningInput } from "../lib/divination/reasoning-input";
import { validateExplainerReport } from "../lib/divination/explainer-report";
import { explainerDraft } from "./fixtures/explainer-fixture";
import { runReasoningStage, reasoningCheckpointKey } from "../lib/server/reasoning-stage";
import { reasoningStageStore, type ReasoningStageStore } from "../lib/server/reasoning-stage-store";
import { withWorkflowDeadline } from "../lib/server/workflow-budget";
import { reasoningFixture, reasoningDraft } from "./fixtures/reasoning-fixture";
import { emptyEvidenceSnapshot, mergeEvidence } from "../lib/divination/evidence-accumulator";

const memoryStore=():ReasoningStageStore=>{const values=new Map<string,unknown>();return {load:async key=>structuredClone(values.get(key)??null),save:async(key,value)=>{values.set(key,structuredClone(value));}};};
beforeEach(()=>vi.stubEnv("LIUYAO_REASONING_MODE","strict"));
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe("PR-6 StructuredReasoning / G12",()=>{
  it("合法两轮推理可生成，程序校验不是适用性或科学预测认证",()=>{
    const c=reasoningFixture(),before=JSON.stringify(c);const r=validateStructuredReasoning(reasoningDraft(c),c);
    expect(r.findings[0].evidence_ids).toHaveLength(2);expect(r.overall_assessment.status).toBe("conditional");expect(JSON.stringify(c)).toBe(before);expect(Object.isFrozen(r)).toBe(true);
  });
  it("G12 不存在的evidence/fact/task及伪造版本hash直接拒绝",()=>{
    const c=reasoningFixture();
    for(const patch of [{evidence_ids:["fake"]},{fact_refs:["fake"]},{task_id:"fake"}]){const r=reasoningDraft(c);Object.assign(r.findings[0],patch);expect(()=>validateStructuredReasoning(r,c)).toThrow();}
    for(const patch of [{chart_hash:"new"},{question_hash:"new"},{version:"fake"}])expect(()=>validateStructuredReasoning({...reasoningDraft(c),...patch},c)).toThrow();
  });
  it("盘面观察不能自由改动月破/动静/生克方向",()=>{
    const c=reasoningFixture(),r=reasoningDraft(c);r.findings[0].observation="本卦第三爻没有月破，官生世。";
    expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_OBSERVATION_INVALID");
  });
  it("初始任务不能漏掉、不能静默删去该任务的冻结条件",()=>{
    const c=reasoningFixture();expect(()=>validateStructuredReasoning({...reasoningDraft(c),findings:[]},c)).toThrow("REASONING_TASK_COVERAGE_REQUIRED");
    const r=reasoningDraft(c);r.findings[0].fact_refs=[];r.findings[0].observation=findingObservation(c,[]);expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_TASK_COVERAGE_REQUIRED");
  });
  it("不能仅引用第二轮，第一轮定义与第二轮例外都须入推理",()=>{
    const c=reasoningFixture(),r=reasoningDraft(c);r.findings[0].evidence_ids=[c.agent.snapshot.evidence[1].evidence_id];expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_ROUND_OMITTED");
  });
  it("重要缺口不能遗漏，也不能提升整体supported",()=>{
    const c=reasoningFixture();c.agent.snapshot={...c.agent.snapshot,unresolved_gaps:[{gap_id:"G1",trigger:{type:"task_gap",task_id:"T1",reason:"insufficient_coverage"},description:"月破例外待核验",assessment:"candidate"}]};
    const r=reasoningDraft(c);r.unresolved_questions=[];expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_GAP_OMITTED");
    r.unresolved_questions=requiredUnresolved(c);r.findings[0].status="supported";r.findings[0].assumptions_or_conditions=[];r.overall_assessment.status="supported";expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_OVERALL_UPGRADE");
  });
  it("冲突必须保留观点及真实finding/evidence引用",()=>{
    const c=reasoningFixture(),r=reasoningDraft(c);r.findings[0].status="conflicting";
    expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_CONFLICT_REQUIRED");
    r.competing_views=[{description:"定义和例外的适用前提尚未厘清。",evidence_ids:[...r.findings[0].evidence_ids],affected_finding_ids:[r.findings[0].finding_id]}];
    expect(validateStructuredReasoning(r,c).competing_views).toHaveLength(1);
    r.competing_views[0].affected_finding_ids=["fake"];expect(()=>validateStructuredReasoning(r,c)).toThrow();
  });
  it("source_conflict不能只当普通条件而删除不同观点",()=>{
    const c=reasoningFixture(),e=c.agent.snapshot.evidence[0];c.agent.snapshot={...c.agent.snapshot,unresolved_gaps:[{gap_id:"G1",trigger:{type:"source_gap",task_id:"T1",reason:"source_conflict",evidence_id:e.evidence_id,source_span_id:e.source_span_id},description:"来源观点冲突",assessment:"candidate"}]};
    expect(()=>validateStructuredReasoning(reasoningDraft(c),c)).toThrow("REASONING_CONFLICT_REQUIRED");
  });
  it("检索已有明确冲突组时也不能静默删除不同观点",()=>{
    const c=structuredClone(reasoningFixture());for(const h of c.agent.snapshot.retrieval_history)for(const unit of h.pack.reasoning_evidence??[])unit.conflict_group_ids=["same-conflict"];
    const r=reasoningDraft(c);expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_CONFLICT_REQUIRED");
    r.competing_views=[{description:"同组材料存在尚未澄清的限制差异。",evidence_ids:r.findings[0].evidence_ids,affected_finding_ids:[r.findings[0].finding_id]}];expect(validateStructuredReasoning(r,c).competing_views).toHaveLength(1);
  });
  it("批准的定义扩展可解释但不得当已存在的盘面事实",()=>{
    const c=reasoningFixture();c.agent.supplemental_tasks=[{extension_id:"EXT1",parent_task_id:"T1",trigger:{type:"source_gap",task_id:"T1",reason:"missing_definition",evidence_id:c.agent.snapshot.evidence[0].evidence_id,source_span_id:c.agent.snapshot.evidence[0].source_span_id},topic_ids:["hidden_spirit"],fact_refs:[],retrieval_question:"伏神定义？",purpose:"resolve_dependency",status:"approved",definitions_only:true}];
    const r=reasoningDraft(c);expect(validateStructuredReasoning(r,c).findings).toHaveLength(2);
    r.findings[1].status="supported";r.findings[1].assumptions_or_conditions=[];expect(()=>validateStructuredReasoning(r,c)).toThrow();
    c.agent.supplemental_tasks[0].status="rejected";expect(()=>validateStructuredReasoning(reasoningDraft({...c,agent:{...c.agent,supplemental_tasks:[{...c.agent.supplemental_tasks[0],status:"approved"}]}}),c)).toThrow("REASONING_TASK_INVALID");
  });
  it("仅案例不能支持结论，未知事实和预测概率也被拒绝",()=>{
    const c=reasoningFixture(),r=reasoningDraft(c);r.findings[0].status="supported";r.findings[0].assumptions_or_conditions=[];
    c.planner.fact_catalog.facts[0].value=null;r.findings[0].observation=findingObservation(c,r.findings[0].fact_refs);expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_UNSUPPORTED_STRENGTH");
    c.planner.fact_catalog.facts[0].value=true;r.findings[0].observation=findingObservation(c,r.findings[0].fact_refs);r.findings[0].interpretation="成功概率90%";expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_TEXT_INVALID");
    let snapshot=emptyEvidenceSnapshot(c.planner.chart_hash,c.planner.question_hash,c.identity);
    for(const h of c.agent.snapshot.retrieval_history){const copy=structuredClone(h);for(const u of copy.pack.reasoning_evidence??[])u.kind="case";snapshot=mergeEvidence(snapshot,copy);}
    c.agent.snapshot=snapshot;r.findings[0].interpretation="仅古例类比";expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_UNSUPPORTED_STRENGTH");
  });
  it("已失效、换release/embedding或篡改quote不能进入推理",()=>{
    for(const mutate of [(c:ReturnType<typeof reasoningFixture>)=>{c.agent.snapshot.status="stale";},(c:ReturnType<typeof reasoningFixture>)=>{c.identity={...c.identity,embedding_profile:"new"};},(c:ReturnType<typeof reasoningFixture>)=>{c.agent.snapshot.evidence[0].text="篡改原文";}]){
      const c=structuredClone(reasoningFixture());mutate(c);expect(()=>validateReasoningContext(c)).toThrow();
    }
  });
  it("所有finding不足时conclusion必须null，不能用overall绕过",()=>{
    const c=reasoningFixture(),r=reasoningDraft(c);r.findings[0].status="insufficient";expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_OVERALL_UPGRADE");
    r.overall_assessment.status="insufficient";expect(()=>validateStructuredReasoning(r,c)).toThrow("REASONING_INSUFFICIENT_CONCLUSION");r.overall_assessment.conclusion=null;expect(validateStructuredReasoning(r,c).overall_assessment.conclusion).toBeNull();
  });
});

describe("Reasoning/Writer budgets and no bypass",()=>{
  it("推理和写作超过旧40秒仍可成功，较短的外层deadline仍优先生效",async()=>{
    vi.useFakeTimers();const c=reasoningFixture(),r=reasoningDraft(c);
    r.explainer=validateExplainerReport(explainerDraft(buildReasoningInput(c).input),r,c,buildReasoningInput(c));
    const slow=(value:unknown)=>vi.fn(()=>new Promise<string>(resolve=>setTimeout(()=>resolve(JSON.stringify(value)),45_000)));
    const reasoning=synthesizeStructuredReasoning(c,slow(r));await vi.advanceTimersByTimeAsync(45_000);expect((await reasoning).status).toBe("ready");
    const writing=writeReasoningText(r,slow(reasoningTextTemplate(r)));await vi.advanceTimersByTimeAsync(45_000);expect((await writing).status).toBe("ready");
    const model=vi.fn(()=>new Promise<string>(()=>{}));
    const short=withWorkflowDeadline(()=>synthesizeStructuredReasoning(c,model),Date.now()+1_000);
    await vi.advanceTimersByTimeAsync(1_001);expect((await short).status).toBe("failed");expect(model).toHaveBeenCalledTimes(1);
  });
  it("推理仅一次格式修复，第二次非法即失败",async()=>{
    const c=reasoningFixture(),r=reasoningDraft(c);r.explainer=validateExplainerReport(explainerDraft(buildReasoningInput(c).input),r,c,buildReasoningInput(c));
    const model=vi.fn().mockResolvedValueOnce("bad").mockResolvedValueOnce(JSON.stringify(r));
    expect((await synthesizeStructuredReasoning(c,model)).status).toBe("ready");expect(model).toHaveBeenCalledTimes(2);
    const bad=vi.fn().mockResolvedValue("bad");const result=await synthesizeStructuredReasoning(c,bad);expect(result.status).toBe("failed");expect(bad).toHaveBeenCalledTimes(2);
  });
  it("推理失败禁止写作，累计快照不变",async()=>{
    const c=reasoningFixture(),before=JSON.stringify(c.agent.snapshot),write=vi.fn();
    const stage=await runReasoningStage("owner",c,async()=>{}, {store:memoryStore(),synthesize:async()=>({status:"failed",attempts:2,code:"REASONING_EVIDENCE_INVALID"}),write});
    expect(stage.status).toBe("reasoning_failed");expect(stage.modern).toBeNull();expect(write).not.toHaveBeenCalled();expect(JSON.stringify(c.agent.snapshot)).toBe(before);
  });
  it("写作失败保留推理并重试时只恢复写作，不再次推理",async()=>{
    const c=reasoningFixture(),store=memoryStore(),synthesize=vi.fn(async()=>({status:"ready" as const,value:reasoningDraft(c),attempts:1})),write=vi.fn().mockResolvedValueOnce({status:"failed",attempts:1,code:"WORKFLOW_NODE_TIMEOUT"}).mockImplementationOnce(async()=>({status:"ready",attempts:1,value:reasoningTextTemplate(reasoningDraft(c))}));
    const first=await runReasoningStage("owner",c,async()=>{}, {store,synthesize,write});expect(first.status).toBe("structured_available");expect(first.reasoning).toBeTruthy();expect(first.modern).toBeNull();
    const second=await runReasoningStage("owner",c,async()=>{}, {store,synthesize,write});expect(second.status).toBe("complete");expect(synthesize).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledTimes(2);
  });
  it("写作不允许新判断、升格状态或伪造引用，必须覆盖全部findings",()=>{
    const r=reasoningDraft(reasoningFixture());for(const mutate of [(t:ReturnType<typeof reasoningTextTemplate>)=>{t.paragraphs[0].text="一定会成功";},(t:ReturnType<typeof reasoningTextTemplate>)=>{t.assessment_status="supported";},(t:ReturnType<typeof reasoningTextTemplate>)=>{t.paragraphs[0].evidence_ids=["fake"];},(t:ReturnType<typeof reasoningTextTemplate>)=>{t.paragraphs=[];}]){const text=reasoningTextTemplate(r);mutate(text);expect(()=>validateReasoningText(text,r)).toThrow();}
  });
  it("受控正文保留所有条件、限制、不同观点及未解决项",()=>{
    const c=reasoningFixture(),r=reasoningDraft(c);r.competing_views=[{description:"例外与定义的前提不同。",evidence_ids:r.findings[0].evidence_ids,affected_finding_ids:[r.findings[0].finding_id]}];r.unresolved_questions=["还需核验前提"];
    const modern=renderReasoningText(reasoningTextTemplate(r),r);
    for(const required of [r.findings[0].interpretation,...r.findings[0].assumptions_or_conditions,...r.findings[0].limitations])expect(modern.overall_interpretation).toContain(required);
    expect(modern.uncertainties).toContain(r.unresolved_questions[0]);expect(r.competing_views[0].description).toBe("例外与定义的前提不同。");
    expect(modern.readings).toEqual([]);expect(modern.disclaimer).toContain("不是对未来事实的科学证明");
  });
  it("写作模型同样最多两次尝试，不增加独立语义审查模型",async()=>{
    const r=reasoningDraft(reasoningFixture()),model=vi.fn().mockResolvedValue("bad");const result=await writeReasoningText(r,model);expect(result.status).toBe("failed");expect(model).toHaveBeenCalledTimes(2);
  });
  it("空证据返回failed且不调用任何推理/写作模型",async()=>{
    const c=reasoningFixture();c.agent.snapshot={...c.agent.snapshot,evidence:[],completed_rounds:1,retrieval_history:[{...c.agent.snapshot.retrieval_history[0],pack:{...c.agent.snapshot.retrieval_history[0].pack,reasoning_evidence:[]}}]};
    const model=vi.fn();const result=await synthesizeStructuredReasoning(c,model);expect(result.status).toBe("failed");expect(result.failure_kind).toBe("insufficient_evidence");expect(model).not.toHaveBeenCalled();
    const write=vi.fn();const stage=await runReasoningStage("owner",c,async()=>{}, {store:memoryStore(),write});expect(stage.status).toBe("reasoning_failed");expect(write).not.toHaveBeenCalled();expect(stage.modern).toBeNull();
  });
  it("120秒节点上限与全局deadline同时生效，截止后不新起调用",async()=>{
    vi.useFakeTimers();const c=reasoningFixture(),model=vi.fn(()=>new Promise<string>(()=>{}));
    const pending=synthesizeStructuredReasoning(c,model);await vi.advanceTimersByTimeAsync(40_001);expect(model).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(80_000);const result=await pending;expect(result.status).toBe("failed");expect(model).toHaveBeenCalledTimes(1);
    const expired=vi.fn();const stopped=await withWorkflowDeadline(()=>synthesizeStructuredReasoning(c,expired),Date.now()-1);expect(stopped.status).toBe("failed");expect(expired).not.toHaveBeenCalled();
  });
  it("推理前/写作前/返回前重新核知识身份，改变后不交付文本",async()=>{
    const c=reasoningFixture(),fresh=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("REASONING_IDENTITY_CHANGED")),write=vi.fn();
    const stage=await runReasoningStage("owner",c,fresh,{store:memoryStore(),synthesize:async()=>({status:"ready",attempts:1,value:reasoningDraft(c)}),write});expect(stage.status).toBe("reasoning_failed");expect(stage.modern).toBeNull();expect(stage.reasoning).toBeUndefined();expect(write).not.toHaveBeenCalled();
  });
  it("写作期限不足时也保留已提交的合法结构分析，不自动绕回旧模型",async()=>{
    const c=reasoningFixture(),fresh=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("WORKFLOW_DEADLINE")),write=vi.fn();
    const result=await runReasoningStage("owner",c,fresh,{store:memoryStore(),synthesize:async()=>({status:"ready",value:reasoningDraft(c),attempts:1}),write});
    expect(result.status).toBe("structured_available");expect(result.reasoning).toBeTruthy();expect(result.modern).toBeNull();expect(write).not.toHaveBeenCalled();
  });
});

describe("Structured checkpoint scope and persistence",()=>{
  it("字面问句、盘、证据、模型/知识版本变化不能复用旧key",()=>{
    const c=reasoningFixture(),key=reasoningCheckpointKey(c);
    for(const mutate of [(v:typeof c)=>{v.question="新的字面问句";},(v:typeof c)=>{v.planner.question_hash="new";},(v:typeof c)=>{v.planner.chart_hash="new";},(v:typeof c)=>{v.identity={...v.identity,embedding_profile:"new"};},(v:typeof c)=>{v.agent.snapshot.evidence[0].text="changed";}]){const other=structuredClone(c);mutate(other);expect(reasoningCheckpointKey(other)).not.toBe(key);}
  });
  it("私人owner隔离、文件恢复完整推理；损坏缓存不会调用写作绕过",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"fortune-reasoning-"));
    try{
      const c=reasoningFixture(),key=reasoningCheckpointKey(c),store=reasoningStageStore("owner",key,directory),other=reasoningStageStore("other",key,directory);
      await store.save("reasoning",reasoningDraft(c));expect(await store.load("reasoning")).toEqual(reasoningDraft(c));expect(await other.load("reasoning")).toBeNull();
      const [root]=await readdir(directory),file=join(directory,root,"reasoning.json");expect((await stat(file)).mode&0o077).toBe(0);
      const envelope=JSON.parse(await readFile(file,"utf8"));envelope.value.chart_hash="corrupt";await writeFile(file,JSON.stringify(envelope));
      const write=vi.fn();const result=await runReasoningStage("owner",c,async()=>{}, {store,write});expect(result.status).toBe("reasoning_failed");expect(write).not.toHaveBeenCalled();
    }finally{await rm(directory,{recursive:true,force:true});}
  });
});
