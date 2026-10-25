import type { ReasoningContext,StructuredReasoningV1,ReasoningFindingV1 } from "./structured-reasoning";
import { findingObservation,reasoningTasks,requiredUnresolved,validateReasoningContext } from "./structured-reasoning";
import type { BuiltReasoningInput } from "./reasoning-input";
import type { ExplainerReport,InterpretationClaim } from "./explainer-report";
import { evidenceCitation } from "./explainer-report";
import { canonicalAnalysis,freezeAnalysis } from "./analysis-utils";

export const FULL_REASONING_VERSION="full-generation-integrity-v5-batch-reference-repair";
const fail=(code:string):never=>{throw new Error(`REASONING_${code}`);};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))return fail("SCHEMA_INVALID");return v as Record<string,unknown>;};
const keys=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))fail("SCHEMA_INVALID");};
const list=(v:unknown,max=100):unknown[]=>{if(!Array.isArray(v)||v.length>max)return fail("SCHEMA_INVALID");return v;};
const text=(v:unknown,max=2000):string=>{if(typeof v!=="string"||!v.trim()||v.length>max)return fail("SCHEMA_INVALID");return v;};
const strings=(v:unknown,max=100)=>{const a=list(v,max).map(s=>text(s));if(new Set(a).size!==a.length)fail("DUPLICATE_REFERENCE");return a;};
const status=(v:unknown)=>{if(!["supported","conditional","conflicting","insufficient"].includes(String(v)))return fail("STATUS_INVALID");return v as ReasoningFindingV1["status"];};
function dataProse(v:unknown,_c:ReasoningContext,max=2000){
  // No NLP semantic regex in full mode. Frozen facts and canonical observations
  // are checked as data below; the model's explanation is not certified true.
  void _c;return text(v,max);
}
function unique<T>(a:T[]){return [...new Set(a)];}
function currentEvidence(ids:string[],c:ReasoningContext){
  if(ids.some(id=>!c.agent.snapshot.evidence.some(e=>e.evidence_id===id)))fail("EVIDENCE_INVALID");
}
export class FullReasoningReferenceError extends Error {
  constructor(public readonly issues: {code:string;path:string;received:unknown;expected:unknown}[]) {super(issues[0].code);}
}
function resolveDraftEvidence(raw:unknown,c:ReasoningContext,built:BuiltReasoningInput,path:string,parents?:string[],max=40):string[]{
  const refs=strings(raw,max);
  const allowed=c.agent.snapshot.evidence.filter(e=>!parents||e.task_ids.some(id=>parents.includes(id)));
  const aliases=Object.entries(built.evidenceIds).filter(([,id])=>allowed.some(e=>e.evidence_id===id)).map(([alias])=>alias);
  const issues=refs.flatMap((ref,index)=>allowed.some(e=>e.evidence_id===(built.evidenceIds[ref]??ref))?[]:[{
    code:"REASONING_EVIDENCE_INVALID",path:`${path}[${index}]`,received:ref,
    expected:{allowed_evidence_ids:aliases,parent_task_ids:parents??null,instruction:"仅从此列表选择确实支持本段的资料；没有适用资料时将任务标为insufficient并说明缺口，不要伪造或改写引用。"},
  }]);
  if(issues.length)throw new FullReasoningReferenceError(issues);
  return refs.map(ref=>built.evidenceIds[ref]??ref);
}
function reportFromDraft(raw:unknown,r:StructuredReasoningV1,c:ReasoningContext,built:BuiltReasoningInput):ExplainerReport{
  const v=obj(raw);keys(v,["sections","limitations"]);const s=obj(v.sections);keys(s,["verdict","advice","analysis"]);
  const sections={verdict:[] as string[],advice:[] as string[],analysis:[] as string[]},claims:InterpretationClaim[]=[];
  const tasks=reasoningTasks(c);
  for(const section of ["verdict","advice","analysis"] as const){
    const rows=list(section==="advice"?(s[section]??[]):s[section],section==="verdict"?2:section==="advice"?4:6);if(!rows.length&&section!=="advice")fail("EXPLAINER_SECTION_REQUIRED");
    for(const [rowIndex,raw] of rows.entries()){
      const p=obj(raw);keys(p,["text","evidence_ids","practical","task_ids"]);
      if(p.practical!==undefined&&typeof p.practical!=="boolean")fail("SCHEMA_INVALID");
      const practical=p.practical===true;if(practical&&section!=="advice")fail("SCHEMA_INVALID");
      const evidence_ids=unique(resolveDraftEvidence(p.evidence_ids,c,built,`explainer.sections.${section}[${rowIndex}].evidence_ids`,undefined,20));
      if(!practical&&!evidence_ids.length)fail("EVIDENCE_REQUIRED");
      const task_ids=p.task_ids===undefined?unique(evidence_ids.flatMap(id=>c.agent.snapshot.evidence.find(e=>e.evidence_id===id)!.task_ids)):strings(p.task_ids,30);
      if(task_ids.some(id=>!c.planner.initial_plan.tasks.some(t=>t.task_id===id)&&!tasks.some(t=>t.task_id===id)))fail("TASK_INVALID");
      resolveDraftEvidence(p.evidence_ids,c,built,`explainer.sections.${section}[${rowIndex}].evidence_ids`,task_ids.map(id=>tasks.find(t=>t.task_id===id)?.parent_task_id??id),20);
      const claim_id=`C${claims.length+1}`,basis_task_ids=task_ids;
      claims.push({claim_id,kind:practical?"practical":section==="verdict"?"synthesis":"rule_application",scope:section==="verdict"?"outcome":"local",
        strength:r.overall_assessment.status,text:dataProse(p.text,c),basis_task_ids,basis_finding_ids:r.findings.filter(f=>basis_task_ids.includes(f.task_id)).map(f=>f.finding_id),
        fact_refs:unique(tasks.filter(t=>basis_task_ids.includes(t.task_id)).flatMap(t=>t.fact_refs)),evidence_ids,rule_application:null});
      sections[section].push(claim_id);
    }
  }
  const ids=unique(claims.flatMap(c=>c.evidence_ids));
  return freezeAnalysis({version:"evidence-explainer-v1.3",generation_mode:"model",validation_mode:"integrity",claims,sections,gap_impacts:[],
    limitations:strings(v.limitations??[],10).map(s=>dataProse(s,c)),citations:ids.map((id,i)=>evidenceCitation(c,id,i+1))});
}

export function compileFullReasoningOutput(raw:unknown,c:ReasoningContext,built:BuiltReasoningInput,requireReport:boolean):StructuredReasoningV1{
  validateReasoningContext(c);
  const v=obj(raw);
  if(requireReport&&!v.explainer)fail("EXPLAINER_REQUIRED");
  if(v.version!==undefined)return validateIntegrityReasoning(raw,c);
  keys(v,["findings","synthesis","explainer"]);
  const tasks=reasoningTasks(c);
  // Return all task-reference errors in one repair round, never alter model prose or citations.
  const referenceIssues:FullReasoningReferenceError["issues"]=[];
  for(const [i,row] of list(v.findings,30).entries()){
    const f=obj(row),task=tasks.find(t=>t.task_id===f.task_id);
    if(!task)fail("TASK_INVALID");
    try{resolveDraftEvidence(f.evidence_ids,c,built,`findings[${i}].evidence_ids`,[task!.parent_task_id]);}
    catch(error){if(error instanceof FullReasoningReferenceError)referenceIssues.push(...error.issues);else throw error;}
  }
  if(referenceIssues.length)throw new FullReasoningReferenceError(referenceIssues);
  const findings=list(v.findings,30).map((raw,i):ReasoningFindingV1=>{
    const f=obj(raw);keys(f,["task_id","fact_refs","evidence_ids","status","interpretation","conditions","limitations"]);
    const task=tasks.find(t=>t.task_id===f.task_id);if(!task)return fail("TASK_INVALID");
    const refs=f.fact_refs===undefined?task.fact_refs:strings(f.fact_refs).map(id=>built.factIds[id]??id);
    const evidence_ids=resolveDraftEvidence(f.evidence_ids,c,built,`findings[${i}].evidence_ids`,[task.parent_task_id]);
    if(refs.some(id=>!c.planner.fact_catalog.facts.some(f=>f.fact_id===id)))fail("FACT_INVALID");
    return {finding_id:`finding_${i+1}`,task_id:task.task_id,fact_refs:refs,evidence_ids,observation:findingObservation(c,refs),status:status(f.status),
      interpretation:dataProse(f.interpretation,c),assumptions_or_conditions:strings(f.conditions??[]).map(s=>dataProse(s,c)),limitations:strings(f.limitations??[]).map(s=>dataProse(s,c))};
  });
  if(new Set(findings.map(f=>f.task_id)).size!==findings.length)fail("DUPLICATE_FINDING");
  const s=obj(v.synthesis);keys(s,["status","conclusion","limitations"]);const assessment=status(s.status);if(assessment==="conflicting")return fail("ASSESSMENT_INVALID");
  if(s.conclusion!==null&&typeof s.conclusion!=="string")fail("SCHEMA_INVALID");
  const r:StructuredReasoningV1={version:"structured-reasoning-v1",validation_mode:"integrity",chart_hash:c.planner.chart_hash,question_hash:c.planner.question_hash,findings,competing_views:[],unresolved_questions:requiredUnresolved(c),
    unreviewed_task_ids:tasks.filter(t=>!findings.some(f=>f.task_id===t.task_id)).map(t=>t.task_id),
    overall_assessment:{status:assessment,conclusion:s.conclusion===null?null:dataProse(s.conclusion,c),reasons:["模型综合结果；当前仅检查数据与引用完整性，未作规则语义验证。"],limitation_notes:strings(s.limitations??[]).map(s=>dataProse(s,c))}};
  if(requireReport&&!v.explainer)fail("EXPLAINER_REQUIRED");
  if(v.explainer){r.explainer=reportFromDraft(v.explainer,r,c,built);r.overall_assessment.conclusion=r.explainer.sections.verdict.map(id=>r.explainer!.claims.find(c=>c.claim_id===id)!.text).join("\n");}
  return validateIntegrityReasoning(r,c);
}

/** No inference/applicability checks. Used both on compilation and cache loads. */
export function validateIntegrityReasoning(raw:unknown,c:ReasoningContext):StructuredReasoningV1{
  validateReasoningContext(c);
  const v=obj(raw);keys(v,["version","validation_mode","unreviewed_task_ids","chart_hash","question_hash","findings","competing_views","unresolved_questions","overall_assessment","explainer"]);
  if(v.version!=="structured-reasoning-v1"||v.validation_mode!=="integrity"||v.chart_hash!==c.planner.chart_hash||v.question_hash!==c.planner.question_hash)fail("IDENTITY_INVALID");
  const tasks=reasoningTasks(c),findings=list(v.findings,30);
  const ids=new Set<string>(),taskIds=new Set<string>();
  for(const row of findings){
    const f=obj(row);keys(f,["finding_id","task_id","observation","fact_refs","evidence_ids","interpretation","status","assumptions_or_conditions","limitations"]);
    const id=text(f.finding_id),taskId=text(f.task_id),task=tasks.find(t=>t.task_id===taskId);if(!task)fail("TASK_INVALID");
    if(ids.has(id)||taskIds.has(taskId))fail("DUPLICATE_FINDING");ids.add(id);taskIds.add(taskId);
    const refs=strings(f.fact_refs);if(refs.some(id=>!c.planner.fact_catalog.facts.some(f=>f.fact_id===id)))fail("FACT_INVALID");
    if(f.observation!==findingObservation(c,refs))fail("OBSERVATION_INVALID");
    const cited=strings(f.evidence_ids);currentEvidence(cited,c);if(cited.some(id=>!c.agent.snapshot.evidence.find(e=>e.evidence_id===id)!.task_ids.includes(task!.parent_task_id)))fail("EVIDENCE_INVALID");
    status(f.status);dataProse(f.interpretation,c);strings(f.assumptions_or_conditions).forEach(s=>dataProse(s,c));strings(f.limitations).forEach(s=>dataProse(s,c));
  }
  const unreviewed=tasks.filter(t=>!taskIds.has(t.task_id)).map(t=>t.task_id);
  if(canonicalAnalysis(v.unreviewed_task_ids)!==canonicalAnalysis(unreviewed))fail("TASK_INVALID");
  const unresolved=strings(v.unresolved_questions);if(requiredUnresolved(c).some(g=>!unresolved.includes(g)))fail("GAP_OMITTED");
  for(const row of list(v.competing_views,30)){const view=obj(row);keys(view,["description","evidence_ids","affected_finding_ids"]);dataProse(view.description,c);currentEvidence(strings(view.evidence_ids),c);if(strings(view.affected_finding_ids).some(id=>!ids.has(id)))fail("TASK_INVALID");}
  const assessment=obj(v.overall_assessment);keys(assessment,["status","conclusion","reasons","limitation_notes"]);if(status(assessment.status)==="conflicting")fail("ASSESSMENT_INVALID");
  if(assessment.conclusion!==null)dataProse(assessment.conclusion,c);strings(assessment.reasons).forEach(s=>dataProse(s,c));strings(assessment.limitation_notes).forEach(s=>dataProse(s,c));
  if(v.explainer!==undefined)validateIntegrityReport(v.explainer,v as unknown as StructuredReasoningV1,c);
  return freezeAnalysis(structuredClone(v as unknown as StructuredReasoningV1));
}
function validateIntegrityReport(raw:unknown,r:StructuredReasoningV1,c:ReasoningContext){
  const v=obj(raw);keys(v,["version","generation_mode","validation_mode","claims","sections","gap_impacts","limitations","citations"]);
  if(v.version!=="evidence-explainer-v1.3"||v.generation_mode!=="model"||v.validation_mode!=="integrity")fail("EXPLAINER_IDENTITY_INVALID");
  const tasks=reasoningTasks(c),ids=new Set<string>(),cited:string[]=[];
  const claims=list(v.claims,20);
  for(const row of claims){
    const claim=obj(row);keys(claim,["claim_id","kind","scope","strength","text","basis_task_ids","basis_finding_ids","fact_refs","evidence_ids","rule_application"]);
    const id=text(claim.claim_id);if(ids.has(id))fail("DUPLICATE_REFERENCE");ids.add(id);dataProse(claim.text,c);status(claim.strength);
    if(!["synthesis","rule_application","practical"].includes(String(claim.kind))||!["local","outcome","timing"].includes(String(claim.scope))||claim.rule_application!==null)fail("SCHEMA_INVALID");
    const parents=strings(claim.basis_task_ids);if(parents.some(id=>!tasks.some(t=>t.task_id===id)))fail("TASK_INVALID");
    if(strings(claim.basis_finding_ids).some(id=>!r.findings.some(f=>f.finding_id===id&&parents.includes(f.task_id))))fail("TASK_INVALID");
    if(strings(claim.fact_refs).some(id=>!c.planner.fact_catalog.facts.some(f=>f.fact_id===id)))fail("FACT_INVALID");
    const evidence=strings(claim.evidence_ids);currentEvidence(evidence,c);if(claim.kind!=="practical"&&!evidence.length)fail("EVIDENCE_REQUIRED");
    if(evidence.some(id=>!c.agent.snapshot.evidence.find(e=>e.evidence_id===id)!.task_ids.some(p=>parents.some(id=>id===p||tasks.some(t=>t.task_id===id&&t.parent_task_id===p)))))fail("EVIDENCE_INVALID");cited.push(...evidence);
  }
  const sections=obj(v.sections);keys(sections,["verdict","advice","analysis"]);const selected:string[]=[];
  for(const name of ["verdict","advice","analysis"]){const refs=strings(sections[name],10);if((!refs.length&&name!=="advice")||refs.some(id=>!ids.has(id)))fail("EXPLAINER_SECTION_REQUIRED");selected.push(...refs);}
  if(new Set(selected).size!==selected.length||selected.length!==ids.size)fail("DUPLICATE_REFERENCE");
  if(list(v.gap_impacts).length)fail("SCHEMA_INVALID");strings(v.limitations).forEach(s=>dataProse(s,c));
  const expected=unique(cited).map((id,i)=>evidenceCitation(c,id,i+1));if(canonicalAnalysis(v.citations)!==canonicalAnalysis(expected))fail("EXPLAINER_CITATION_INVALID");
}
