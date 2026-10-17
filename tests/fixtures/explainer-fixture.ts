import type { BuiltReasoningInput } from "../../lib/divination/reasoning-input";
import type { InterpretationClaim,RuleApplication } from "../../lib/divination/explainer-report";

export function explainerDraft(input:BuiltReasoningInput["input"],status:"supported"|"conditional"|"insufficient"="conditional"){
  const task=input.allowed_tasks.find(t=>t.fact_refs.length&&input.evidence.some(e=>e.task_ids.includes(t.parent_task_id)))!;
  const e=input.evidence.find(e=>e.task_ids.includes(task.parent_task_id))!,topic_id=task.topic_ids[0];
  const application:RuleApplication={evidence_links:[{evidence_id:e.evidence_id,topic_id,quote:e.text,use:"limits",relevance:"原文列示理论条件，是否适用于本次问事仍待核验。"}],
    conditions:[{description:"适用条件尚待核验。",state:"unknown",fact_refs:[]}],exceptions_checked:["例外尚未核验，不视为已经排除。"],applicability:status==="insufficient"?"insufficient":"conditional"};
  const base={basis_task_ids:[task.task_id],fact_refs:task.fact_refs,rule_application:application};
  const claims:Omit<InterpretationClaim,"basis_finding_ids"|"evidence_ids">[]=[
    {...base,claim_id:"C1",kind:"synthesis",scope:"outcome",strength:status,text:"围绕本次问事，现有原文仅能说明需要核验哪些条件，尚不足以确定现实结果。"},
    {claim_id:"C2",kind:"practical",scope:"local",strength:"insufficient",text:"继续按岗位要求准备申请，并根据实际回复调整安排。",basis_task_ids:[],fact_refs:[],rule_application:null},
    {...base,claim_id:"C3",kind:"rule_application",scope:"local",strength:status,text:"已确认的盘面结构与原文条件可以对照，但是否形成有效作用仍待核验。"},
  ];return {claims,sections:{verdict:["C1"],advice:["C2"],analysis:["C3"]},
    gap_impacts:(input.gap_records??[]).map(g=>({gap_id:g.gap_id,classification:g.required_classification,affected_claim_ids:["C1","C3"],reason:"缺口仍影响所引用条件的评估，不据此升级判断。"})),limitations:["现有理论适用条件未完全核验。"]};
}
export function lightweightExplainerDraft(input:BuiltReasoningInput["input"],status:"supported"|"conditional"|"insufficient"="conditional"){
  const full=explainerDraft(input,status);
  const paragraph=(id:string)=>{
    const claim=full.claims.find(c=>c.claim_id===id)!;
    return claim.kind==="practical"?{practical:true,text:claim.text}:{text:claim.text,basis_task_ids:claim.basis_task_ids,
      evidence_links:claim.rule_application!.evidence_links.map(({quote,...link})=>{void quote;return link;}),
      conditions:claim.rule_application!.conditions.map(c=>c.description),exceptions_checked:claim.rule_application!.exceptions_checked};
  };
  return {sections:{verdict:full.sections.verdict.map(paragraph),advice:full.sections.advice.map(paragraph),analysis:full.sections.analysis.map(paragraph)},limitations:full.limitations};
}
