import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it,expect,vi } from "vitest";
import { reasoningFixture,reasoningDraft } from "./fixtures/reasoning-fixture";
import { explainerDraft,lightweightExplainerDraft } from "./fixtures/explainer-fixture";
import { buildReasoningInput } from "../lib/divination/reasoning-input";
import { validateExplainerReport,conservativeExplainer } from "../lib/divination/explainer-report";
import { validateStructuredReasoning } from "../lib/divination/structured-reasoning";
import { renderReasoningText,reasoningTextTemplate,validateReasoningText } from "../lib/divination/reasoning-text";
import { compileReasoningOutput } from "../lib/divination/reasoning-output";
import { writeReasoningText } from "../lib/server/structured-reasoning-llm";
import InterpretationPanel from "../app/divination/interpretation-panel";
import type { DivinationInterpretationResult } from "../lib/contracts/divination";

function setup(){const c=structuredClone(reasoningFixture()),r=reasoningDraft(c),b=buildReasoningInput(c),raw=explainerDraft(b.input);return {c,r,b,raw};}
function verify(s:ReturnType<typeof setup>){return validateExplainerReport(s.raw,s.r,s.c,s.b);}
describe("Evidence-backed three-section explainer",()=>{
  it("strict rollback also accepts the new two-section prompt shape",()=>{
    const s=setup(),raw=lightweightExplainerDraft(s.b.input),{advice,...sections}=raw.sections;void advice;
    const report=validateExplainerReport({...raw,sections},s.r,s.c,s.b);
    expect(report.sections.advice).toEqual([]);
  });
  it("compiles lightweight model paragraphs without asking the model to repeat program-owned fields",()=>{
    const s=setup();
    const paragraph=(id:string)=>{const c=s.raw.claims.find(c=>c.claim_id===id)!;return c.kind==="practical"?{practical:true,text:c.text}:{text:c.text,basis_task_ids:c.basis_task_ids,evidence_links:c.rule_application!.evidence_links.map(({quote,...link})=>{void quote;return link;}),conditions:c.rule_application!.conditions.map(c=>c.description),exceptions_checked:c.rule_application!.exceptions_checked};};
    const draft={sections:{verdict:[paragraph("C1")],advice:[paragraph("C2")],analysis:[paragraph("C3")]},limitations:s.raw.limitations};
    const report=validateExplainerReport(draft,s.r,s.c,s.b);
    expect(report.claims[0].kind).toBe("synthesis");expect(report.claims[0].scope).toBe("outcome");expect(report.claims[0].strength).toBe(s.r.overall_assessment.status);
    expect(report.claims[0].fact_refs).toEqual(s.r.findings[0].fact_refs);expect(report.claims[0].rule_application!.evidence_links[0].quote).toBe(s.c.agent.snapshot.evidence[0].text);
    expect(()=>validateExplainerReport({...draft,sections:{...draft.sections,verdict:[{...draft.sections.verdict[0],strength:"supported"}]}},s.r,s.c,s.b)).toThrow("SCHEMA_INVALID");
  });
  it("revalidates claims, stable program citations and cross-task synthesis without copying findings",()=>{
    const s=setup();s.c.planner.initial_plan.tasks.push({...s.c.planner.initial_plan.tasks[0],task_id:"T2"});
    s.r.findings.push({...s.r.findings[0],finding_id:"finding2",task_id:"T2",evidence_ids:[],status:"insufficient"});
    s.raw.claims[0].basis_task_ids.push("T2");
    const report=verify(s);expect(report.claims[0].basis_finding_ids).toEqual(["finding1","finding2"]);
    expect(report.citations[0].number).toBe(1);expect(report.citations[0].quote).toBe(s.c.agent.snapshot.evidence[0].text);
    expect(report.citations[0].title).toBe("典籍名称未提供");expect(report.citations[0].url).toBeUndefined();
    s.r.explainer=report;const validated=validateStructuredReasoning(s.r,s.c);
    const modern=renderReasoningText(reasoningTextTemplate(validated),validated);
    expect(modern.overall_interpretation).toContain("断语\n\n");expect(modern.overall_interpretation).toContain("行动建议");expect(modern.overall_interpretation).toContain("卦理分析");
    expect(modern.overall_interpretation).toContain("[1]");expect(modern.overall_interpretation).toContain("现实建议：");
    expect(modern.overall_interpretation).not.toContain(s.r.findings[0].interpretation);
    expect(modern.explainer).toEqual(report);
  });
  it.each(["evidence","quote","basis","fact"])("rejects fabricated %s even when other IDs are valid",field=>{
    const s=setup(),claim=s.raw.claims[0];
    if(field==="evidence")claim.rule_application!.evidence_links[0].evidence_id="invented";
    if(field==="quote")claim.rule_application!.evidence_links[0].quote="这是一段原文中并不存在的古籍断语。";
    if(field==="basis")claim.basis_task_ids=["UNRELATED_TASK"];
    if(field==="fact")claim.fact_refs=["FOREIGN_CHART_FACT"];
    expect(()=>verify(s)).toThrow();
  });
  it("does not accept a lexically unrelated real quote merely because its ID exists",()=>{
    const s=setup();s.c.agent.snapshot.evidence[0].text="此处只记载别的事情，不涉及所需理论。";
    s.raw.claims[0].rule_application!.evidence_links[0].quote=s.c.agent.snapshot.evidence[0].text;
    expect(()=>verify(s)).toThrow("REASONING_EXPLAINER_IRRELEVANT_QUOTE");
  });
  it("a synthesis cannot bypass the finding's original task/evidence boundary",()=>{
    const s=setup();s.r.findings[0].evidence_ids=[];
    expect(()=>verify(s)).toThrow("REASONING_EXPLAINER_EVIDENCE_INVALID");
  });
  it("unknown conditions cannot be applicable or supported, and a false fact match cannot be met",()=>{
    const s=setup(),a=s.raw.claims[0].rule_application!;a.applicability="applicable";a.evidence_links[0].use="supports";
    expect(()=>verify(s)).toThrow("APPLICATION_UPGRADE");
    a.conditions=[{description:"已核验月破",state:"met",fact_refs:["F1"],expected_value:false} as typeof a.conditions[number]];
    expect(()=>verify(s)).toThrow("CONDITION_UNVERIFIED");
    a.conditions=[{description:"未知条件",state:"unknown",fact_refs:[]}];a.applicability="conditional";s.raw.claims[0].strength="supported";
    expect(()=>verify(s)).toThrow("UNSUPPORTED_STRENGTH");
  });
  it("an unmet rule condition cannot be labelled conditional applicability",()=>{
    const s=setup(),a=s.raw.claims[0].rule_application!;
    a.conditions=[{description:"实际事实与规则前提不符",state:"unmet",fact_refs:["F1"],expected_value:false} as typeof a.conditions[number]];
    expect(()=>verify(s)).toThrow("APPLICATION_UPGRADE");
  });
  it("case-only material cannot be promoted to rule support",()=>{
    const s=setup();s.c.agent.snapshot.evidence[0].kind="case";s.raw.claims[0].rule_application!.evidence_links[0].use="supports";
    expect(()=>verify(s)).toThrow("CASE_UPGRADE");
  });
  it("background and limiting evidence are not silently classified as supports",()=>{
    const s=setup();const report=verify(s);expect(report.claims[0].rule_application!.evidence_links[0].use).toBe("limits");
    expect(report.claims[0].rule_application!.applicability).toBe("conditional");
  });
  it("materializes the exact saved original when the model only selects an evidence ID",()=>{
    const s=setup();Reflect.deleteProperty(s.raw.claims[0].rule_application!.evidence_links[0],"quote");
    const report=verify(s);expect(report.claims[0].rule_application!.evidence_links[0].quote).toBe(s.c.agent.snapshot.evidence[0].text);
  });
  it("a rule selecting response as use-role cannot support a different program role",()=>{
    const s=setup();s.c.agent.snapshot.evidence[0].text="应为用神，旺相生合世爻。月破条件须另论。";
    const link=s.raw.claims[0].rule_application!.evidence_links[0];Reflect.deleteProperty(link,"quote");link.use="supports";
    expect(()=>verify(s)).toThrow("RULE_ROLE_MISMATCH");
    link.use="limits";link.relevance="此原文取用前提不同，不可直接套用本问，仅说明当前理论资料的局限。";
    expect(verify(s).claims[0].rule_application!.evidence_links[0].use).toBe("limits");
  });
  it("practical advice has no counterfeit ancient-text provenance",()=>{
    const s=setup();s.raw.claims[1].basis_task_ids=["T1"];expect(()=>verify(s)).toThrow("PRACTICAL_DISGUISED");
  });
  it("structural declaration cannot hide an unsupported theoretical judgment",()=>{
    const s=setup();s.raw.claims[2].kind="structural";s.raw.claims[2].rule_application=null;s.raw.claims[2].text="世爻月破所以求职必败。";
    expect(()=>verify(s)).toThrow("STRUCTURAL_UPGRADE");
  });
  it.each(["世爻月破与月令旺标签存在理论冲突。","世生官表明求测者已经行动。","用神已经化退，职位会消退。"])("rejects unsafe key judgment %s",text=>{
    const s=setup();s.raw.claims[0].text=text;expect(()=>verify(s)).toThrow();
  });
  it("core gaps cannot be downgraded, omitted, or detached from verdict",()=>{
    const s=setup();s.c.agent.snapshot.unresolved_gaps=[{gap_id:"G1",trigger:{type:"task_gap",task_id:"T1",reason:"insufficient_coverage"},description:"条件未核验",assessment:"candidate"}];
    s.raw=explainerDraft(buildReasoningInput(s.c).input);
    expect(verify(s).gap_impacts[0].classification).toBe("core");
    s.raw.gap_impacts[0].classification="secondary";expect(()=>verify(s)).toThrow("GAP_DOWNGRADE");
    s.raw.gap_impacts[0].classification="core";s.raw.gap_impacts[0].affected_claim_ids=["C3"];expect(()=>verify(s)).toThrow("GAP_OMITTED");
    s.raw.gap_impacts=[];expect(()=>verify(s)).toThrow("GAP_OMITTED");
  });
  it.each(["time","secondary"] as const)("keeps a %s gap distinct without upgrading the overall judgment",classification=>{
    const s=setup();s.c.planner.initial_plan.tasks.push({...s.c.planner.initial_plan.tasks[0],task_id:"OTHER",kind:classification==="time"?"timing":"role_condition",priority:"optional"});
    s.c.agent.snapshot.unresolved_gaps=[{gap_id:"G1",trigger:{type:"task_gap",task_id:"OTHER",reason:"insufficient_coverage"},description:"其他条件待核验",assessment:"candidate"}];
    s.raw=explainerDraft(buildReasoningInput(s.c).input);
    const report=verify(s);expect(report.gap_impacts[0].classification).toBe(classification);expect(report.claims[0].strength).toBe("conditional");
  });
  it("source URLs and titles come from retrieval metadata, not from model text",()=>{
    const s=setup(),unit=s.c.agent.snapshot.retrieval_history[0].pack.reasoning_evidence![0];unit.summary="测试典籍\n"+unit.source_quotes[0].quote;unit.source_quotes[0].url="https://example.org/source";
    const report=verify(s);expect(report.citations[0].title).toBe("测试典籍");expect(report.citations[0].url).toBe("https://example.org/source");
    const tampered=structuredClone(report);tampered.citations[0].title="伪造典籍";
    expect(()=>validateExplainerReport(tampered,s.r,s.c)).toThrow("CITATION_INVALID");
  });
  it("production cannot accept an old response as a new report; legacy compiler remains readable",()=>{
    const s=setup();expect(()=>compileReasoningOutput(s.r,s.c,s.b,true)).toThrow("REASONING_EXPLAINER_REQUIRED");
    expect(compileReasoningOutput(s.r,s.c,s.b).version).toBe("structured-reasoning-v1");
  });
  it("new reports never add a writer model call or accept an independently rewritten report",async()=>{
    const s=setup();s.r.explainer=verify(s);const model=vi.fn();const result=await writeReasoningText(s.r,model);
    expect(model).not.toHaveBeenCalled();expect(result.attempts).toBe(0);
    const text=reasoningTextTemplate(s.r);text.report_hash="changed";expect(()=>validateReasoningText(text,s.r)).toThrow("WRITING_REPORT_CHANGED");
  });
  it("safe partial report never promotes source availability into rule support or reuses failed prose",()=>{
    const s=setup();s.r.overall_assessment={status:"insufficient",conclusion:null,reasons:["部分分析"],limitation_notes:["不作最终预测。"]};
    s.r.findings[0].interpretation="BAD_FAILED_REPORT_PROSE";
    const report=conservativeExplainer(s.r,s.c)!;expect(report.generation_mode).toBe("safe_fallback");
    expect(report.claims.every(c=>c.strength==="insufficient")).toBe(true);
    expect(report.claims.flatMap(c=>c.rule_application?.evidence_links??[]).every(l=>l.use!=="supports")).toBe(true);
    expect(report.claims.map(c=>c.text).join("\n")).not.toContain("BAD_FAILED_REPORT_PROSE");
    expect(report.claims.some(c=>c.text.includes("月破成立"))).toBe(true);
  });
  it("UI and API share three blocks, program citation anchors, and one cultural disclaimer",()=>{
    const s=setup();s.r.explainer=verify(s);const modern=renderReasoningText(reasoningTextTemplate(s.r),s.r);
    const result={modern_interpretation:modern,analysis_status:"complete",structured_reasoning:s.r,evidence_snapshot:s.c.agent.snapshot,evidence_pack:{primary:{name:"随",upper_trigram:"兑",lower_trigram:"震"},transformed:{name:"震"},moving_lines:[5],evidence:[],sources:[]}} as unknown as DivinationInterpretationResult;
    const html=renderToStaticMarkup(createElement(InterpretationPanel,{result}));
    for(const title of ["断语","行动建议","卦理分析"])expect(html).toContain(`<h4>${title}</h4>`);
    expect(html).toContain('href="#explainer-evidence-1"');expect(html).toContain('id="explainer-evidence-1"');
    expect(html).toContain("典籍依据与适用条件");expect(html.match(/不是对未来事实的科学证明/g)).toHaveLength(1);
  });
});
