import { findingObservation, factObservations, requiredUnresolved, reasoningTasks, knownConflictGroups, validateStructuredReasoning, validatePartialStructuredReasoning, STRUCTURED_REASONING_VERSION, type ReasoningContext, type StructuredReasoningV1, type ReasoningFindingV1 } from "./structured-reasoning";
import type { BuiltReasoningInput } from "./reasoning-input";
import { assertFactClaimDirections, assertNoUnverifiedDerivation } from "./fact-claim-guard";
import { validateExplainerReport, ExplainerValidationError } from "./explainer-report";
import { compileFullReasoningOutput, FullReasoningReferenceError } from "./full-reasoning";

export interface ReasoningIssue {code:string;path:string;received?:unknown;expected?:unknown}
export class ReasoningValidationError extends Error {
  constructor(public readonly issues:ReasoningIssue[]){super(issues[0]?.code??"REASONING_SCHEMA_INVALID");}
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function requireKeys(v:Record<string,unknown>,allowed:string[],path:string){
  const extra=Object.keys(v).filter(k=>!allowed.includes(k));if(extra.length)throw new ReasoningValidationError(extra.map(k=>({code:"REASONING_SCHEMA_INVALID",path:`${path}.${k}`,expected:"omit program-owned field"})));
}
function validateProse(raw:unknown,path:string,c:ReasoningContext){
  if(typeof raw!=="string")return;
  try{assertFactClaimDirections(raw,c.planner.fact_catalog);assertNoUnverifiedDerivation(raw);}catch(error){
    const descriptions=factObservations(c);
    throw new ReasoningValidationError([{code:error instanceof Error?error.message:"REASONING_FACT_CLAIM_INVALID",path,received:raw,expected:{
      directed_facts:c.planner.fact_catalog.facts.filter(f=>f.type==="line_relationship").map(f=>descriptions[f.fact_id]),
      instruction:"当前盘面只可沿用上述程序关系；原文泛论须明确标注为原文，不得当作当前事实。进退神未由程序判定，只讨论未核验的定义。"}}]);
  }
}
function views(c:ReasoningContext,findings:ReasoningFindingV1[]){
  const groups=knownConflictGroups(c).map(ids=>({ids,description:"来源存在尚待核验的不同条件或观点。"}));
  for(const gap of c.agent.snapshot.unresolved_gaps)if(gap.trigger.type==="source_gap"&&gap.trigger.reason==="source_conflict")groups.push({ids:[gap.trigger.evidence_id],description:gap.description});
  const result=groups.map(g=>({description:g.description,evidence_ids:g.ids,affected_finding_ids:findings.filter(f=>f.evidence_ids.some(id=>g.ids.includes(id))).map(f=>f.finding_id)})).filter(g=>g.affected_finding_ids.length);
  for(const f of findings)if(f.status==="conflicting"&&!result.some(v=>v.affected_finding_ids.includes(f.finding_id)))result.push({description:f.limitations.join("；"),evidence_ids:f.evidence_ids,affected_finding_ids:[f.finding_id]});
  return result;
}
function envelope(c:ReasoningContext,findings:ReasoningFindingV1[],synthesis:StructuredReasoningV1["overall_assessment"]):StructuredReasoningV1 {
  return {version:STRUCTURED_REASONING_VERSION,chart_hash:c.planner.chart_hash,question_hash:c.planner.question_hash,findings,competing_views:views(c,findings),unresolved_questions:requiredUnresolved(c),overall_assessment:synthesis};
}
const partialAssessment=()=>({status:"insufficient" as const,conclusion:null,reasons:["仅保留已经通过验证的任务分析，尚未形成完整结论。"],limitation_notes:["部分任务未通过验证；不得据此作最终预测。"]});
export function compileReasoningOutput(raw:unknown,c:ReasoningContext,built:BuiltReasoningInput,requireExplainer=false):StructuredReasoningV1 {
  if(c.validation_mode==="integrity"){
    try{return compileFullReasoningOutput(raw,c,built,requireExplainer);}catch(error){if(error instanceof FullReasoningReferenceError)throw new ReasoningValidationError(error.issues);throw new ReasoningValidationError([{code:error instanceof Error?error.message:"REASONING_SCHEMA_INVALID",path:"$"}]);}
  }
  // Existing public V1 is still accepted by the public validator, not rewritten.
  if(obj(raw)&&raw.version===STRUCTURED_REASONING_VERSION){if(requireExplainer&&!raw.explainer)throw new ReasoningValidationError([{code:"REASONING_EXPLAINER_REQUIRED",path:"explainer"}]);return validateStructuredReasoning(raw,c);}
  if(!obj(raw))throw new ReasoningValidationError([{code:"REASONING_SCHEMA_INVALID",path:"$",expected:"object"}]);
  requireKeys(raw,["findings","synthesis","explainer"],"$");
  if(!Array.isArray(raw.findings)||raw.findings.length>30)throw new ReasoningValidationError([{code:"REASONING_SCHEMA_INVALID",path:"findings",expected:"array <=30"}]);
  const findings=raw.findings.map((f,i)=>compileFinding(f,i,c,built));
  if(!obj(raw.synthesis))throw new ReasoningValidationError([{code:"REASONING_SCHEMA_INVALID",path:"synthesis"}]);
  const s=raw.synthesis;requireKeys(s,["status","conclusion","limitations"],"synthesis");
  validateProse(s.conclusion,"synthesis.conclusion",c);
  if(Array.isArray(s.limitations))s.limitations.forEach((text,i)=>validateProse(text,`synthesis.limitations[${i}]`,c));
  const all=partialAssessment();
  all.reasons=[s.status==="supported"?"各任务在所选传统体系内具备可引用依据。":"任务存在前提、冲突或资料缺口，不能作为确定的现实预测。"];
  const result=envelope(c,findings,{status:s.status as StructuredReasoningV1["overall_assessment"]["status"],conclusion:s.conclusion as string|null,reasons:all.reasons,limitation_notes:s.limitations as string[]});
  try{
    const validated=validateStructuredReasoning(result,c);
    if(requireExplainer&&!raw.explainer)throw new Error("REASONING_EXPLAINER_REQUIRED");
    if(raw.explainer){
      const explainer=validateExplainerReport(raw.explainer,validated,c,built);
      return validateStructuredReasoning({...validated,explainer,overall_assessment:{...validated.overall_assessment,conclusion:validated.overall_assessment.status==="insufficient"?null:explainer.sections.verdict.map(id=>explainer.claims.find(c=>c.claim_id===id)!.text).join("\n")}},c);
    }
    return validated;
  }catch(error){if(error instanceof ExplainerValidationError)throw new ReasoningValidationError(error.issues);throw new ReasoningValidationError([{code:error instanceof Error?error.message:"REASONING_SCHEMA_INVALID",path:raw.explainer?"explainer":"synthesis_or_coverage"}]);}
}
function compileFinding(raw:unknown,index:number,c:ReasoningContext,built:BuiltReasoningInput):ReasoningFindingV1 {
  const path=`findings[${index}]`;
  if(!obj(raw))throw new ReasoningValidationError([{code:"REASONING_SCHEMA_INVALID",path}]);
  requireKeys(raw,["task_id","fact_refs","evidence_ids","status","interpretation","limitations","conditions"],path);
  const task=reasoningTasks(c).find(t=>t.task_id===raw.task_id);
  if(!task)throw new ReasoningValidationError([{code:"REASONING_TASK_INVALID",path:`${path}.task_id`,received:raw.task_id,expected:reasoningTasks(c).map(t=>t.task_id)}]);
  const resolve=(field:"fact_refs"|"evidence_ids",aliases:Record<string,string>)=>{
    const refs=raw[field];if(!Array.isArray(refs)||refs.some(r=>typeof r!=="string"))throw new ReasoningValidationError([{code:"REASONING_SCHEMA_INVALID",path:`${path}.${field}`}]);
    const ids=refs.map(r=>aliases[r]??r);
    ids.forEach((id,j)=>{if(field==="fact_refs"?!task.fact_refs.includes(id)||!c.planner.fact_catalog.facts.some(f=>f.fact_id===id):!c.agent.snapshot.evidence.some(e=>e.evidence_id===id&&e.task_ids.includes(task.parent_task_id)))throw new ReasoningValidationError([{code:field==="fact_refs"?"REASONING_FACT_INVALID":"REASONING_EVIDENCE_INVALID",path:`${path}.${field}[${j}]`,received:refs[j],expected:field==="fact_refs"?task.fact_refs:c.agent.snapshot.evidence.filter(e=>e.task_ids.includes(task.parent_task_id)).map(e=>e.evidence_id)}]);});
    return ids;
  };
  const refs=resolve("fact_refs",built.factIds),evidence=resolve("evidence_ids",built.evidenceIds);
  const f:ReasoningFindingV1={finding_id:`finding_${index+1}`,task_id:task.task_id,fact_refs:refs,evidence_ids:evidence,observation:findingObservation(c,refs),status:raw.status as ReasoningFindingV1["status"],interpretation:raw.interpretation as string,
    assumptions_or_conditions:(raw.conditions??(task.definitions_only?["进退神规则尚未由程序核定，仅可研究定义和适用前提。"]:[])) as string[],limitations:(Array.isArray(raw.limitations)?raw.limitations.filter(x=>!Array.isArray(raw.conditions)||!raw.conditions.includes(x)):raw.limitations) as string[]};
  validateProse(raw.interpretation,`${path}.interpretation`,c);
  if(Array.isArray(raw.limitations))raw.limitations.forEach((text,i)=>validateProse(text,`${path}.limitations[${i}]`,c));
  try{
    const verified=validatePartialStructuredReasoning(envelope(c,[f],partialAssessment()),c);
    if(task.fact_refs.some(id=>!refs.includes(id)))throw new Error("REASONING_TASK_COVERAGE_REQUIRED");
    return verified.findings[0];
  }catch(error){throw new ReasoningValidationError([{code:error instanceof Error?error.message:"REASONING_SCHEMA_INVALID",path}]);}
}
export function salvageReasoningOutput(raw:unknown,c:ReasoningContext,built:BuiltReasoningInput):StructuredReasoningV1|undefined {
  if(!obj(raw)||!Array.isArray(raw.findings))return;
  const findings:ReasoningFindingV1[]=[];
  for(const [i,f] of raw.findings.entries()){
    try{const accepted=compileFinding(f,i,c,built);if(!findings.some(g=>g.task_id===accepted.task_id))findings.push(accepted);}catch{/* Unvalidated model prose is never used. */}
  }
  if(!findings.length)return;
  return validatePartialStructuredReasoning(envelope(c,findings,partialAssessment()),c);
}
