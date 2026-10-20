import { mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HybridEvidencePack, HybridEvidenceUnit } from "../lib/contracts/divination";
import type { FactCatalog } from "../lib/divination/analysis-facts";
import type { InitialAnalysisPlan } from "../lib/divination/analysis-plan";
import type { SingleQuestionAnalysis } from "../lib/divination/question-analysis";
import { compileRetrievalRequests } from "../lib/divination/query-compiler";
import { emptyEvidenceSnapshot, mergeEvidence, quoteHash, accumulatedEvidencePack } from "../lib/divination/evidence-accumulator";
import { machineGaps, validateGapAnalysis, type GapContext } from "../lib/divination/evidence-gap";
import { runEvidenceAgent, validateAgentCheckpoint, type AgentInput, type AgentResult } from "../lib/divination/agent-controller";
import { analyzeEvidenceGaps } from "../lib/server/evidence-gap-llm";
import { boundedWorkflow, withWorkflowDeadline, workflowFetch } from "../lib/server/workflow-budget";
import { evidenceAgentStore } from "../lib/server/evidence-agent-store";
import { compileGapProposals, gapProposalAnchors, GapProposalError } from "../lib/divination/gap-proposals";
import { saveGapDiagnostics, type GapDiagnosticRun } from "../lib/server/gap-diagnostics";

const identity={knowledge_release_id:"release1",embedding_profile:"embedding1",revocation_hash:"rev1"};
const plan={version:"initial-analysis-plan-v1",chart_hash:"chart1",question_hash:"question1",taxonomy_version:"topics1",prompt_version:"p1",status:"generated",warnings:[],plan_hash:"plan1",
  tasks:[{task_id:"T1",kind:"month_day_effect",fact_refs:["F1"],topic_ids:["month_break"],retrieval_question:"月破条件是什么？",depends_on:[],priority:"high",why_needed:"冻结事实月破"}]} as InitialAnalysisPlan;
const facts={version:"analysis-facts-v1",chart_hash:"chart1",roles_version:"roles1",facts:[{fact_id:"F1",type:"month_break",subject_ref:"main:3",value:true,source:"frozen_core"}]} as FactCatalog;
const question={status:"valid",event_type:"new_job"} as SingleQuestionAnalysis;
const compiled=compileRetrievalRequests(plan,facts,question);
function unit(entity:string,text:string,start=0,source="source1"):HybridEvidenceUnit{
  return {entity_revision_id:entity,entity_id:entity,kind:"passage",summary:text,not_for_interpretation:false,condition_evaluation:"unknown",conflict_group_ids:[],content_type:"theory",
    source_quotes:[{source_revision_id:source,quote:text,quote_hash:quoteHash(text),start,end:start+[...text].length,offset_unit:"unicode_codepoint"}]};
}
function pack(round:1|2=1,units:HybridEvidenceUnit[]=[],hits=units.length):HybridEvidencePack{
  return {chart_id:"chart-id",chart_hash:"chart1",core_version:"core1",method_profile_id:"method1",knowledge_release_id:"release1",retrieval_run_id:`run${round}`,retrieval_identity:identity,
    status:"evidence_insufficient",reasoning_evidence:units,supporting_evidence:[],pending_conditions:units,counter_evidence:[],gaps:[],clarification:[],selected_use:[],candidate_roles:[],
    retrieval_trace:[{round,request_id:round===1?"r1_1":"r2_1",parent_task_id:"T1",keyword_hits:hits,vector_hits:0,selected_evidence_ids:units.map(u=>u.entity_revision_id),keyword_top:units.map(u=>({entity_revision_id:u.entity_revision_id,score:round*2}))}],
    interpretation_contract:{strong_conclusion_allowed:false,recast_allowed:false,copy_case_outcome:false}};
}
const empty=()=>emptyEvidenceSnapshot("chart1","question1",identity);
function context(units:HybridEvidenceUnit[]=[],hits=units.length):GapContext{return {plan,facts,question,evidence:mergeEvidence(empty(),{round:1,requests:compiled.requests,pack:pack(1,units,hits)})};}
function draft(){return {decision:"retrieve_more",gaps:[{gap_id:"G1",trigger:{type:"task_gap",task_id:"T1",reason:"no_results"},description:"需要月破例外定义"}],supplemental_tasks:[],additional_requests:[{request_id:"r2_1",parent_task_id:"T1",target_type:"theory",topic_ids:["month_break"],semantic_intent:"查例外条件",keyword_terms:["月破","破而不破"],fact_refs:["F1"],priority:"high"}],stop_reason:null};}
function sourceDraft(c:GapContext){const d=draft(),e=c.evidence.evidence[0];return {...d,gaps:[{gap_id:"G1",trigger:{type:"source_gap",task_id:"T1",evidence_id:e.evidence_id,source_span_id:e.source_span_id,reason:"missing_exception"},description:"原文例外待查"}]};}
const input=():AgentInput=>({chart_id:"chart-id",question_hash:"question1",identity,compiled,plan,facts,question,fingerprint:"fingerprint1",deadlineAt:180000});
function harness(first=pack(),second=pack(2,[unit("exception","月破例外，另有条件。",100)])){
  let saved:AgentResult|null=null;const checkpoints:AgentResult[]=[];
  return {checkpoints,get saved(){return saved;},
    deps:{now:()=>0,retrieve:vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),analyze:vi.fn(async(c:GapContext)=>validateGapAnalysis(draft(),c)),
      load:vi.fn(async()=>saved),save:vi.fn(async(state:AgentResult)=>{saved=structuredClone(state);checkpoints.push(saved);})}};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe("PR-5 intent compiler and private audit",()=>{
  const proposal=()=>({decision:"retrieve_more",proposals:[{parent_task_id:"T1",trigger_type:"task_gap",topic_ids:["month_break"],knowledge_need:"查月破例外及条件"}]});
  it("minimal intent derives IDs, facts, priority and controlled query without changing P1",()=>{
    const c=context(),before=JSON.stringify(c.plan),result=compileGapProposals(proposal(),c),r=result.additional_requests[0];
    expect(result.decision).toBe("retrieve_more");expect(r).toMatchObject({parent_task_id:"T1",priority:"high",target_type:"theory",fact_refs:["F1"]});
    expect(r.request_id).toMatch(/^r2_/);expect(r.keyword_terms).toEqual(["月破","破而不破"]);expect(JSON.stringify(c.plan)).toBe(before);
    expect(compileGapProposals(proposal(),c).compiled?.compilation_hash).toBe(result.compiled?.compilation_hash);
  });
  it.each([
    [{parent_task_id:"BAD"},"UNKNOWN_TASK","parent_task_id"],
    [{topic_ids:["BAD"]},"UNKNOWN_TOPIC","topic_ids[0]"],
    [{topic_ids:["hidden_spirit"]},"TOPIC_NOT_ALLOWED","topic_ids[0]"],
    [{priority:"critical"},"PRIORITY_MISMATCH","priority"],
    [{fact_refs:["F_09"]},"INVALID_FACT_REF","fact_refs"],
    [{trigger_type:"source_gap",trigger_ref:"invented"},"MISSING_TRIGGER_EVIDENCE","trigger_ref"],
  ])("rejects invalid proposal %j with exact field diagnostic",(patch,code,field)=>{
    const p=proposal();Object.assign(p.proposals[0],patch);
    try{compileGapProposals(p,context());throw new Error("expected validation failure");}catch(error){expect(error).toBeInstanceOf(GapProposalError);expect((error as GapProposalError).issues).toContainEqual(expect.objectContaining({code,path:`proposals[0].${field}`}));}
  });
  it("source-only extension requires real parent-scoped anchor and remains definition-only",()=>{
    const c=context([unit("source","月破条件须兼论伏神定义。")]),anchor=gapProposalAnchors(c).find(a=>a.trigger.type==="source_gap"&&a.topic_ids.includes("hidden_spirit"))!;
    const p=proposal();Object.assign(p.proposals[0],{trigger_type:"source_gap",trigger_ref:anchor.anchor_id,topic_ids:["hidden_spirit"]});
    const result=compileGapProposals(p,c);expect(result.supplemental_tasks[0]).toMatchObject({status:"approved",definitions_only:true});expect(c.plan.tasks[0].topic_ids).toEqual(["month_break"]);
    c.plan={...c.plan,tasks:[...c.plan.tasks,{...c.plan.tasks[0],task_id:"T2"}]};
    Object.assign(p.proposals[0],{parent_task_id:"T2"});expect(()=>compileGapProposals(p,c)).toThrow(GapProposalError);
  });
  it("frozen expansion requires an actual related unplanned fact",()=>{
    const c=context();c.facts={...c.facts,facts:[...c.facts.facts,{fact_id:"H1",type:"hidden_location",subject_ref:"hidden:3",value:{flying_line_ref:"main:3"},source:"frozen_core"}]};
    const anchor=gapProposalAnchors(c).find(a=>a.trigger.type==="frozen_fact"&&a.topic_ids.includes("hidden_spirit"))!;
    const p=proposal();Object.assign(p.proposals[0],{trigger_type:"frozen_fact",trigger_ref:anchor.anchor_id,topic_ids:["hidden_spirit"]});
    expect(compileGapProposals(p,c).additional_requests[0].fact_refs).toEqual(["F1","H1"]);
    c.facts={...c.facts,facts:c.facts.facts.filter(f=>f.fact_id!=="H1")};expect(()=>compileGapProposals(p,c)).toThrow(GapProposalError);
  });
  it("rejects stop with requests, bounds proposal count and prevents cosmetic duplicate queries",()=>{
    expect(()=>compileGapProposals({...proposal(),decision:"stop"},context())).toThrow(GapProposalError);
    expect(()=>compileGapProposals({...proposal(),proposals:Array(4).fill(proposal().proposals[0])},context())).toThrow(GapProposalError);
    const c=context(),first=compileGapProposals(proposal(),c);c.evidence={...c.evidence,retrieval_history:[...c.evidence.retrieval_history,{...c.evidence.retrieval_history[0],requests:first.additional_requests}]};
    const p=proposal();p.proposals[0].knowledge_need="换个措辞";const result=compileGapProposals(p,c);
    expect(result.decision).toBe("stop");expect(result.validation_issues?.[0].code).toBe("DUPLICATE_QUERY");
  });
  it("repair receives original output and structured issues; raw drafts never enter result",async()=>{
    const invalid=JSON.stringify({...proposal(),proposals:[{...proposal().proposals[0],priority:"critical"}]}),model=vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(JSON.stringify(proposal()));
    const runs:GapDiagnosticRun[]=[],result=await analyzeEvidenceGaps(context(),model,async run=>{runs.push(structuredClone(run));});
    expect(model.mock.calls[1][1].repair).toMatchObject({previous_output:invalid,validation_issues:[{code:"PRIORITY_MISMATCH",path:"proposals[0].priority"}]});
    expect(runs[1].attempts.map(a=>a.outcome)).toEqual(["rejected","accepted"]);expect(runs[1].attempts[0].raw_output).toBe(invalid);
    expect(result.decision).toBe("retrieve_more");expect(JSON.stringify(result)).not.toContain("raw_output");expect(result.validation_issues).toBeUndefined();
  });
  it("audit write failure safely stops supplemental retrieval",async()=>{
    const result=await analyzeEvidenceGaps(context(),async()=>JSON.stringify(proposal()),async()=>{throw new Error("disk full");});
    expect(result.stop_reason).toBe("GAP_FAILED_GAP_DIAGNOSTIC_WRITE_FAILED");expect(result.additional_requests).toEqual([]);
  });
  it("audit directory and files have owner-only permissions",async()=>{
    const temp=await mkdtemp(join(tmpdir(),"gap-audit-")),root=join(temp,"private");
    try{
      await saveGapDiagnostics({run_id:"12345678-1234-1234-1234-123456789abc",created_at:"test",chart_hash:"chart",plan_hash:"plan",attempts:[]},root);
      const files=await readdir(root);expect((await stat(root)).mode&0o777).toBe(0o700);expect((await stat(join(root,files[0]))).mode&0o777).toBe(0o600);
      expect(JSON.parse(await readFile(join(root,files[0]),"utf8")).plan_hash).toBe("plan");
    }finally{await rm(temp,{recursive:true,force:true});}
  });
});

describe("PR-5 G01–G11 / Gap validator",()=>{
  it("G01 真正零召回无需伪造来源也能补检",async()=>{
    const h=harness();const result=await runEvidenceAgent(input(),h.deps);
    expect(result.snapshot.completed_rounds).toBe(2);expect(h.deps.retrieve).toHaveBeenCalledTimes(2);
    expect(h.checkpoints[0].snapshot.completed_rounds).toBe(1);expect(h.checkpoints[0].snapshot.retrieval_history[0].pack.retrieval_trace?.[0].keyword_hits).toBe(0);
    expect(result.snapshot.unresolved_gaps.length).toBeGreaterThan(0);expect(result.snapshot.status).toBe("partial");
  });
  it("G02 原文例外必须引用同一证据真实span及父任务",()=>{
    const c=context([unit("definition","月破有例外，须核条件。")]);const d=sourceDraft(c);
    expect(validateGapAnalysis(d,c).decision).toBe("retrieve_more");
    for(const patch of [{evidence_id:"fake"},{source_span_id:"fake"},{task_id:"fake"}])expect(()=>validateGapAnalysis({...d,gaps:[{...d.gaps[0],trigger:{...d.gaps[0].trigger,...patch}}]},c)).toThrow();
  });
  it("G03 伏神扩展需原文触发，审批后只增Round2不改变P1；无盘面事实只查定义",()=>{
    const c=context([unit("definition","月破亦须核伏神之条件。")]);const before=JSON.stringify(plan);
    const d=sourceDraft(c);const trigger=d.gaps[0].trigger;
    const result=validateGapAnalysis({...d,additional_requests:[],supplemental_tasks:[{extension_id:"EXT1",parent_task_id:"T1",trigger,topic_ids:["hidden_spirit"],fact_refs:[],retrieval_question:"伏神定义的适用条件？",purpose:"resolve_dependency",status:"proposed"}]},c);
    expect(result.supplemental_tasks[0].status).toBe("approved");expect(result.supplemental_tasks[0].definitions_only).toBe(true);
    expect(result.compiled?.round).toBe(2);expect(result.compiled?.queries[0].query).toBe("伏神");expect(JSON.stringify(plan)).toBe(before);
  });
  it("G04 单纯模型联想/递归/虚构事实不获批准",()=>{
    const c=context([unit("definition","月破须核条件。")]),d=sourceDraft(c);
    const extension={extension_id:"EXT1",parent_task_id:"T1",trigger:d.gaps[0].trigger,topic_ids:["hidden_spirit"],fact_refs:[],retrieval_question:"伏神定义？",purpose:"resolve_dependency",status:"proposed"};
    expect(validateGapAnalysis({...d,additional_requests:[],supplemental_tasks:[extension]},c).supplemental_tasks[0].status).toBe("rejected");
    expect(()=>validateGapAnalysis({...d,supplemental_tasks:[{...extension,parent_task_id:"EXT0"}]},c)).toThrow();
    expect(()=>validateGapAnalysis({...d,supplemental_tasks:[{...extension,fact_refs:["invented"]}]},c)).toThrow();
  });
  it("冻结事实可补漏，但必须是真实同父结构且未计划的fact",()=>{
    const c=context(),fact={fact_id:"H1",type:"hidden_location" as const,subject_ref:"main:3",value:"hidden:3",source:"frozen_core" as const};
    c.facts={...facts,facts:[...facts.facts,fact]};
    const d={...draft(),additional_requests:[],supplemental_tasks:[{extension_id:"EXT1",parent_task_id:"T1",trigger:{type:"frozen_fact",parent_task_id:"T1",fact_id:"H1",reason:"unplanned_relevant_fact"},topic_ids:["hidden_spirit"],fact_refs:["H1"],retrieval_question:"伏神定义？",purpose:"resolve_dependency",status:"proposed"}]};
    expect(validateGapAnalysis(d,c).supplemental_tasks[0].status).toBe("approved");
    c.facts={...c.facts,facts:[...facts.facts,{...fact,subject_ref:"main:99"}]};
    expect(validateGapAnalysis(d,c).supplemental_tasks[0].status).toBe("rejected");
  });
  it("G05 同query改意图/词序不能骗取第二轮",()=>{
    const c=context(),d=draft();d.additional_requests[0]={...d.additional_requests[0],keyword_terms:["月建","月破"],semantic_intent:"换个说法再查"};
    const result=validateGapAnalysis(d,c);expect(result.decision).toBe("stop");expect(result.stop_reason).toBe("NO_NOVEL_REQUESTS");
  });
  it("no_results不能冒充有召回或根本没执行；候选低相关判断不升级为确认",()=>{
    expect(()=>validateGapAnalysis(draft(),context([],2))).toThrow("GAP_NOT_EMPTY");
    const c=context();c.evidence={...c.evidence,retrieval_history:[]};expect(()=>validateGapAnalysis(draft(),c)).toThrow("GAP_NOT_EMPTY");
    const d=draft();d.gaps[0].trigger.reason="low_relevance";
    expect(validateGapAnalysis(d,context([],2)).gaps[0].assessment).toBe("candidate");
  });
  it("最多3条、非法额外字段/关键词与无触发请求被拒绝",()=>{
    const c=context(),d=draft();
    expect(()=>validateGapAnalysis({...d,additional_requests:Array(4).fill(d.additional_requests[0])},c)).toThrow();
    expect(()=>validateGapAnalysis({...d,question:"改问"},c)).toThrow();
    expect(()=>validateGapAnalysis({...d,gaps:[]},c)).toThrow("QUERY_TRIGGER_REQUIRED");
    expect(()=>validateGapAnalysis({...d,additional_requests:[{...d.additional_requests[0],keyword_terms:["必吉"]}]},c)).toThrow();
  });
  it("G06 一般定义和例外同时留存，旧写作适配器也是两轮并集",async()=>{
    const h=harness(pack(1,[unit("definition","月破一般定义。")]),pack(2,[unit("exception","月破例外，须另核。",100)]));
    h.deps.analyze.mockImplementation(async c=>validateGapAnalysis(sourceDraft(c),c));
    const state=await runEvidenceAgent(input(),h.deps);
    expect(state.snapshot.evidence).toHaveLength(2);expect(state.snapshot.evidence.map(e=>e.rounds)).toEqual([[1],[2]]);
    expect(accumulatedEvidencePack(state.snapshot)?.reasoning_evidence?.map(e=>e.entity_revision_id)).toEqual(["definition","exception"]);
    expect(state.snapshot.retrieval_history).toHaveLength(2);
  });
  it("G07 第二轮超时保留已经保存的Round1、缺口及原因",async()=>{
    const h=harness(pack(1,[unit("definition","月破定义与例外。")]))
    h.deps.analyze.mockImplementation(async c=>validateGapAnalysis(sourceDraft(c),c));
    h.deps.retrieve.mockReset().mockResolvedValueOnce(pack(1,[unit("definition","月破定义与例外。")])).mockRejectedValueOnce(new Error("WORKFLOW_NODE_TIMEOUT"));
    const result=await runEvidenceAgent(input(),h.deps);
    expect(result.snapshot.completed_rounds).toBe(1);expect(result.snapshot.status).toBe("partial");
    expect(result.snapshot.evidence[0].text).toContain("月破定义");expect(result.snapshot.errors).toContain("WORKFLOW_NODE_TIMEOUT");expect(result.snapshot.unresolved_gaps.length).toBeGreaterThan(0);
    expect(h.checkpoints[0].stop_reason).toBe("ROUND1_SAVED");
  });
  it("G08 G1两次无效后停止，不删除Round1",async()=>{
    const c=context([unit("definition","月破定义。")]);const model=vi.fn().mockResolvedValue("not-json");
    const analysis=await analyzeEvidenceGaps(c,model);expect(model).toHaveBeenCalledTimes(2);expect(analysis.decision).toBe("stop");
    const h=harness(pack(1,[unit("definition","月破定义。")]))
    h.deps.analyze.mockResolvedValue(analysis);const state=await runEvidenceAgent(input(),h.deps);
    expect(state.snapshot.evidence).toHaveLength(1);expect(h.deps.retrieve).toHaveBeenCalledTimes(1);expect(state.stop_reason).toMatch(/^GAP_FAILED/);
  });
  it("显式重试只恢复失败的Round2，不重复Round1/G1，完成后也不产生第三轮",async()=>{
    const h=harness();h.deps.retrieve.mockReset().mockResolvedValueOnce(pack()).mockRejectedValueOnce(new Error("WORKFLOW_NODE_TIMEOUT")).mockResolvedValueOnce(pack(2,[unit("exception","月破例外。",100)]));
    const first=await runEvidenceAgent(input(),h.deps);expect(first.stop_reason).toBe("ROUND2_FAILED");
    await runEvidenceAgent(input(),h.deps);expect(h.deps.retrieve).toHaveBeenCalledTimes(2);
    const retried=await runEvidenceAgent({...input(),retryIncomplete:true},h.deps);expect(retried.snapshot.completed_rounds).toBe(2);expect(h.deps.retrieve).toHaveBeenCalledTimes(3);expect(h.deps.analyze).toHaveBeenCalledTimes(1);
    await runEvidenceAgent({...input(),retryIncomplete:true},h.deps);expect(h.deps.retrieve).toHaveBeenCalledTimes(3);
  });
  it("G09/G10 不同问句hash、盘hash、知识identity不能读取旧checkpoint",async()=>{
    const h=harness();const state=await runEvidenceAgent(input(),h.deps);
    expect(()=>validateAgentCheckpoint(state,{...input(),question_hash:"new-question"})).toThrow();
    expect(()=>validateAgentCheckpoint(state,{...input(),plan:{...plan,chart_hash:"new-chart"}})).toThrow();
    expect(()=>validateAgentCheckpoint(state,{...input(),identity:{...identity,embedding_profile:"new-model"}})).toThrow();
  });
  it("G11 deadline已到，不启动检索或G1",async()=>{
    const h=harness();h.deps.now=()=>180000;
    const state=await runEvidenceAgent(input(),h.deps);expect(state.stop_reason).toBe("GLOBAL_DEADLINE");expect(h.deps.retrieve).not.toHaveBeenCalled();expect(h.deps.analyze).not.toHaveBeenCalled();
    const model=vi.fn();await withWorkflowDeadline(()=>analyzeEvidenceGaps(context(),model),Date.now()-10);expect(model).not.toHaveBeenCalled();
  });
  it("剩余不足50s停止补检，终止快照重试不重检、不重跑G1",async()=>{
    const h=harness();let now=0;h.deps.now=()=>now;
    h.deps.retrieve.mockReset().mockImplementation(async()=>{now=131000;return pack();});
    const state=await runEvidenceAgent(input(),h.deps);expect(state.stop_reason).toBe("INSUFFICIENT_TAIL_BUDGET");expect(h.deps.analyze).not.toHaveBeenCalled();
    await runEvidenceAgent(input(),h.deps);expect(h.deps.retrieve).toHaveBeenCalledTimes(1);
  });
  it("知识版本在Round2改变：保留审计证据，但失效资料不送写作",async()=>{
    const h=harness();h.deps.retrieve.mockReset().mockResolvedValueOnce(pack()).mockResolvedValueOnce({...pack(2),retrieval_identity:{...identity,revocation_hash:"new-revocation"}});
    const state=await runEvidenceAgent(input(),h.deps);expect(state.snapshot.status).toBe("stale");expect(state.snapshot.completed_rounds).toBe(1);expect(accumulatedEvidencePack(state.snapshot)).toBeNull();
  });
  it("没有缺口/新请求时一轮停止，不为了凑双轮检索",async()=>{
    const h=harness(pack(1,[unit("definition","月破定义。")]))
    h.deps.analyze.mockResolvedValue({decision:"stop",gaps:[],additional_requests:[],supplemental_tasks:[],stop_reason:"NO_NEW_DEPENDENCY"});
    const state=await runEvidenceAgent(input(),h.deps);expect(state.snapshot.completed_rounds).toBe(1);expect(h.deps.retrieve).toHaveBeenCalledTimes(1);expect(state.snapshot.status).toBe("complete");
  });
});

describe("EvidenceAccumulator provenance",()=>{
  it("精确片段跨轮合并归因与分数，原始日志不覆盖",()=>{
    const first=context([unit("same","月破条件。")]).evidence;
    const req={...draft().additional_requests[0],target_type:"theory" as const,topic_ids:["month_break" as const],priority:"high" as const};
    const merged=mergeEvidence(first,{round:2,requests:[req],pack:pack(2,[unit("same","月破条件。")])});
    expect(merged.evidence).toHaveLength(1);expect(merged.evidence[0].rounds).toEqual([1,2]);expect(merged.evidence[0].scores_by_request).toEqual({r1_1:2,r2_1:4});
    expect(first.completed_rounds).toBe(1);expect(merged.retrieval_history[0].pack.retrieval_trace?.[0].keyword_top).toEqual([{entity_revision_id:"same",score:2}]);
  });
  it("不同重叠片段不丢弃，传递重叠同组",()=>{
    const c=context([unit("a","月破条件定义甲乙丙",0),unit("b","条件定义甲乙丙丁戊",3),unit("c","丙丁戊己庚",10)]);
    expect(c.evidence.evidence).toHaveLength(3);expect(new Set(c.evidence.evidence.map(e=>e.shared_source_group)).size).toBe(1);expect(c.evidence.evidence[0].shared_source_group).toBeTruthy();
  });
  it("同文本不同source版本不盲目合并；相同版本不同位置保留origins",()=>{
    const c=context([unit("a","同文",0,"source-v1"),unit("b","同文",0,"source-v2"),unit("c","同文",20,"source-v1")]);
    expect(c.evidence.evidence).toHaveLength(2);expect(c.evidence.evidence[0].origins).toHaveLength(2);expect(c.evidence.evidence[0].same_text_group).toBe(c.evidence.evidence[1].same_text_group);
  });
  it("unicode codepoint偏移保留，不拿UTF16长度冒充Python来源坐标",()=>{
    const c=context([unit("a","😀月破",7)]);const e=c.evidence.evidence[0];expect(e.end_offset_exclusive).toBe(10);expect(e.text).toBe("😀月破");
  });
  it("伪造quote_hash、错误release、第三轮与篡改checkpoint均拒绝",async()=>{
    const u=unit("a","月破");u.source_quotes[0].quote_hash="fake";expect(()=>context([u])).toThrow("EVIDENCE_QUOTE_INVALID");
    expect(()=>mergeEvidence(empty(),{round:1,requests:compiled.requests,pack:{...pack(),knowledge_release_id:"other"}})).toThrow();
    const h=harness(),state=await runEvidenceAgent(input(),h.deps);const clone=structuredClone(state);clone.snapshot.evidence[0].text="篡改";
    expect(()=>validateAgentCheckpoint(clone,input())).toThrow();
    expect(()=>mergeEvidence(state.snapshot,{round:2,requests:[],pack:pack(2)})).toThrow();
  });
  it("机器缺口不把无trace未执行的任务写成no_results",()=>{
    const c=context();c.evidence={...c.evidence,retrieval_history:[]};expect(machineGaps(c)[0].trigger.reason).toBe("insufficient_coverage");
  });
});

describe("durable checkpoint and hard budgets",()=>{
  it("owner隔离、持久化Round1+Round2日志、恢复不重检",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"fortune-agent-"));
    try{
      const store=evidenceAgentStore("owner","fingerprint1",dir),other=evidenceAgentStore("other","fingerprint1",dir),h=harness();
      const deps={...h.deps,...store};const first=await runEvidenceAgent(input(),deps);
      expect((await store.load())?.snapshot.completed_rounds).toBe(2);expect(await other.load()).toBeNull();
      const state=await runEvidenceAgent(input(),deps);expect(state).toEqual(first);expect(h.deps.retrieve).toHaveBeenCalledTimes(2);
      const roots=await readdir(dir);const files=await readdir(join(dir,roots.find(r=>r!=="")!));expect(files.length).toBeGreaterThanOrEqual(4);
      const raw=JSON.parse(await readFile(join(dir,roots[0],"checkpoint.json"),"utf8"));expect(raw.digest).toMatch(/^[0-9a-f]{64}$/);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("stop结果的undefined可选字段正确持久化，缺latest仍从journal恢复",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"fortune-agent-journal-"));
    try{
      const store=evidenceAgentStore("owner","fingerprint1",dir),h=harness(pack(1,[unit("definition","月破定义。")]))
      h.deps.analyze.mockResolvedValue(validateGapAnalysis({decision:"stop",gaps:[],supplemental_tasks:[],additional_requests:[],stop_reason:"NO_GAP"},context([unit("definition","月破定义。")])));
      const first=await runEvidenceAgent(input(),{...h.deps,...store});expect((await store.load())?.stop_reason).toBe("NO_GAP");
      const [root]=await readdir(dir);await rename(join(dir,root,"checkpoint.json"),join(dir,root,"checkpoint.saved"));
      expect((await store.load())?.snapshot.completed_rounds).toBe(1);
      const second=await runEvidenceAgent(input(),{...h.deps,...store});expect(second.snapshot.evidence).toEqual(first.snapshot.evidence);expect(h.deps.retrieve).toHaveBeenCalledTimes(1);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("node超时会abort真实fetch；后续同scope不再发出新调用",async()=>{
    vi.useFakeTimers();const fetch=vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal?.addEventListener("abort",()=>reject(new Error("ABORTED")))));vi.stubGlobal("fetch",fetch);
    const work=withWorkflowDeadline(()=>boundedWorkflow(100,()=>workflowFetch("https://example.invalid")));
    const assertion=expect(work).rejects.toThrow();await vi.advanceTimersByTimeAsync(101);await assertion;expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    const expired=withWorkflowDeadline(()=>workflowFetch("https://example.invalid"),Date.now()-1);await expect(expired).rejects.toThrow("WORKFLOW_DEADLINE");expect(fetch).toHaveBeenCalledTimes(1);
  });
});
