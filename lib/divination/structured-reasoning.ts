import type { InitialPlannerSnapshot } from "../server/analysis-planner";
import type { AgentResult } from "./agent-controller";
import type { EvidenceRecord } from "./evidence-accumulator";
import { emptyEvidenceSnapshot, mergeEvidence } from "./evidence-accumulator";
import { analysisHash, canonicalAnalysis, freezeAnalysis } from "./analysis-utils";
import { assertFactClaimDirections, assertNoUnverifiedDerivation } from "./fact-claim-guard";
import type { FrozenQuestionRecord } from "../contracts/divination";
import { extractAnalysisFacts, verifiedRoles } from "./analysis-facts";
import { resolveReviewedUseRoles } from "./deterministic-use-roles";
import { validateExplainerReport, type ExplainerReport } from "./explainer-report";
import { validateIntegrityReasoning } from "./full-reasoning";

export const STRUCTURED_REASONING_VERSION="structured-reasoning-v1";
export type FindingStatus="supported"|"conditional"|"conflicting"|"insufficient";
export interface ReasoningFindingV1 {
  finding_id:string;task_id:string;observation:string;fact_refs:string[];evidence_ids:string[];interpretation:string;
  status:FindingStatus;assumptions_or_conditions:string[];limitations:string[];
}
export interface CompetingViewV1 {description:string;evidence_ids:string[];affected_finding_ids:string[]}
export interface StructuredReasoningV1 {
  validation_mode?:"integrity"|"strict";
  unreviewed_task_ids?:string[];
  explainer?:ExplainerReport;
  version:typeof STRUCTURED_REASONING_VERSION;chart_hash:string;question_hash:string;findings:ReasoningFindingV1[];
  competing_views:CompetingViewV1[];unresolved_questions:string[];
  overall_assessment:{status:"supported"|"conditional"|"insufficient";conclusion:string|null;reasons:string[];limitation_notes:string[]};
}
export interface ReasoningContext {research_question_zh?:string;planner:InitialPlannerSnapshot;agent:AgentResult;question:string;identity:Record<string,unknown>;frozen?:FrozenQuestionRecord;validation_mode?:"integrity"|"strict"}
export const reasoningHash=(reasoning:StructuredReasoningV1)=>analysisHash(reasoning);
const labels={role_binding:"角色定位",moving:"动静",transformation:"动变",month_break:"月破",day_clash:"日冲",xun_empty:"旬空",month_seasonal_label:"月令标签",hidden_location:"伏神位置",line_relationship:"有向五行关系"};
const lineName=(ref:string)=>ref.replace(/^main:([1-6])$/,"本卦第$1爻").replace(/^hidden:([1-6])$/,"第$1位伏神").replace(/^(?:transformed|changed):([1-6])$/,"变卦第$1爻");
const roles:Record<string,string>={officials:"官鬼",wealth:"妻财",parents:"父母",siblings:"兄弟",offspring:"子孙",self:"世爻",response:"应爻"};
export function factObservations(c:ReasoningContext){return Object.fromEntries(c.planner.fact_catalog.facts.map(f=>{
  const name=lineName(f.subject_ref),v=f.value as Record<string,unknown>|null;let description:string;
  if(f.value===null)description=`${labels[f.type]}信息未知`;
  else if(f.type==="moving")description=f.value===true?"发动":f.value===false?"静爻":"动静未知";
  else if(["month_break","day_clash","xun_empty"].includes(f.type))description=f.value===true?`${labels[f.type]}成立`:f.value===false?`${labels[f.type]}不成立`:`${labels[f.type]}未知`;
  else if(f.type==="month_seasonal_label")description=`月令标签为“${String(f.value)}”（不等于综合旺衰）`;
  else if(f.type==="role_binding"&&v)description=`${v.priority==="primary"?"主观察角色":"辅助观察角色"}为${roles[String(v.role)]??String(v.role)}`;
  else if(f.type==="transformation"&&v)description=`由${v.from_branch??"未知"}${v.from_element??""}变为${v.to_branch??"未知"}${v.to_element??""}，变爻六亲为${roles[String(v.changed_kin)]??String(v.changed_kin??"未知")}`;
  else if(f.type==="hidden_location"&&v)description=`飞爻位置为${typeof v.flying_line_ref==="string"?lineName(v.flying_line_ref):"未知"}，伏神可用状态为${v.usability_status==="unknown"?"未知":String(v.usability_status??"未知")}`;
  else if(f.type==="line_relationship"&&v){const relation:Record<string,string>={generates:"生向",controls:"克向",same_element:"与其同五行",generated_by:"受其所生",controlled_by:"受其所克"};description=`五行${v.source_element??"未知"} → ${lineName(f.object_ref??"未知") }（${v.target_element??"未知"}），方向关系：${relation[String(v.element_relation)]??"未知"}`;}
  else description=`${labels[f.type]}=${canonicalAnalysis(f.value)}`;
  return [f.fact_id,`${name}：${description}`];
}));}
export function findingObservation(c:ReasoningContext,refs:string[]){const catalog=factObservations(c);return refs.length?refs.map(id=>catalog[id]).join("；"):"此任务没有可新增的冻结盘面事实。";}
export function reasoningTasks(c:ReasoningContext){return [...c.planner.initial_plan.tasks.map(t=>({task_id:t.task_id,parent_task_id:t.task_id,fact_refs:t.fact_refs,definitions_only:t.topic_ids.includes("advance_retreat")})),
  ...c.agent.supplemental_tasks.filter(t=>t.status==="approved").map(t=>({task_id:t.extension_id,parent_task_id:t.parent_task_id,fact_refs:t.fact_refs,definitions_only:Boolean(t.definitions_only)}))];}
export function requiredUnresolved(c:ReasoningContext):string[]{
  return [...c.agent.snapshot.unresolved_gaps.map(g=>`[${g.gap_id}] ${g.description}`),
    ...c.agent.supplemental_tasks.filter(t=>c.validation_mode!=="integrity"&&t.status==="approved"&&t.definitions_only).map(t=>`[${t.extension_id}] 仅核查定义，不据此新增盘面事实或断定适用。`),
    ...c.agent.snapshot.errors.map(code=>`[检索限制] ${code}`)];
}
export function knownConflictGroups(c:ReasoningContext):string[][]{
  const groups=new Map<string,Set<string>>();
  for(const h of c.agent.snapshot.retrieval_history)for(const unit of h.pack.reasoning_evidence??[])for(const group of unit.conflict_group_ids??[]){
    const members=groups.get(group)??new Set<string>();members.add(unit.entity_revision_id);groups.set(group,members);
  }
  return [...groups.values()].filter(ids=>ids.size>1).map(ids=>c.agent.snapshot.evidence.filter(e=>e.origins.some(o=>ids.has(o.entity_revision_id))).map(e=>e.evidence_id)).filter(ids=>ids.length>1);
}
export function validateReasoningContext(c:ReasoningContext){
  const p=c.planner,s=c.agent.snapshot;
  if(p.status!=="ready"||p.question_analysis.status!=="valid"||p.question_analysis.normalized_question!==c.question||s.status==="stale"||s.completed_rounds<1||s.chart_hash!==p.chart_hash||s.question_hash!==p.question_hash
    ||p.initial_plan.chart_hash!==p.chart_hash||p.initial_plan.question_hash!==p.question_hash||canonicalAnalysis(s.retrieval_identity)!==canonicalAnalysis(c.identity))throw new Error("REASONING_CONTEXT_INVALID");
  if(p.fact_catalog.chart_hash!==p.chart_hash||p.use_roles.chart_hash!==p.chart_hash||p.use_roles.status!=="generated"
    ||new Set(p.fact_catalog.facts.map(f=>f.fact_id)).size!==p.fact_catalog.facts.length
    ||p.initial_plan.tasks.some(t=>t.fact_refs.some(id=>!p.fact_catalog.facts.some(f=>f.fact_id===id))))throw new Error("REASONING_CONTEXT_INVALID");
  if(c.frozen){
    const frozen=c.frozen,confirmed=frozen.confirmed_question,core=frozen.cast.core_facts;
    if(!core||frozen.confirmation_status!=="confirmed"||!confirmed||confirmed.state!=="confirmed"||confirmed.normalized_question!==c.question||confirmed.question_hash!==p.question_hash
      ||confirmed.confirmation_id!==p.confirmation_id||frozen.cast.chart_hash!==p.chart_hash||frozen.cast.chart_id!==p.chart_id)throw new Error("REASONING_CONTEXT_INVALID");
    const roles=verifiedRoles(core,p.use_roles,p.chart_hash),reviewed=resolveReviewedUseRoles(core,p.chart_hash,p.question_analysis);
    const signature=(r:typeof roles)=>canonicalAnalysis([r.primary?.role,r.primary?.main_line_refs,r.primary?.hidden_line_refs,r.auxiliary.map(a=>[a.role,a.main_line_refs,a.hidden_line_refs])]);
    if(reviewed.status!=="unsupported"&&(!reviewed.analysis||reviewed.status!=="resolved"||signature(reviewed.analysis)!==signature(roles)))throw new Error("REASONING_USE_ROLE_CHANGED");
    if(canonicalAnalysis(extractAnalysisFacts(core,roles,p.chart_hash))!==canonicalAnalysis(p.fact_catalog))throw new Error("REASONING_FROZEN_FACTS_CHANGED");
  }
  let replay=emptyEvidenceSnapshot(p.chart_hash,p.question_hash,c.identity);
  for(const round of s.retrieval_history){if(round.pack.chart_id!==p.chart_id)throw new Error("REASONING_CONTEXT_INVALID");replay=mergeEvidence(replay,round);}
  if(canonicalAnalysis(replay.evidence)!==canonicalAnalysis(s.evidence)||replay.completed_rounds!==s.completed_rounds)throw new Error("REASONING_PROVENANCE_INVALID");
}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("REASONING_SCHEMA_INVALID");return v as Record<string,unknown>;};
const keys=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))throw new Error("REASONING_SCHEMA_INVALID");};
export function reasoningText(v:unknown,max=1500):string{
  if(typeof v!=="string"||!v.trim()||v.length>max||/一定会|必然会|必定会|必吉|必凶|注定|百分之\d|\d+\s*[%％]|保证成功|保证失败|证明.{0,8}(喜欢你|讨厌你|心理|意愿)|科学证明|无需就医|停止服药/.test(v))throw new Error("REASONING_TEXT_INVALID");
  return v;
}
const array=(v:unknown,max=100):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw new Error("REASONING_SCHEMA_INVALID");return v;};
const strings=(v:unknown,max=100):string[]=>{const a=array(v,max).map(s=>reasoningText(s));if(new Set(a).size!==a.length)throw new Error("REASONING_DUPLICATE_REFERENCE");return a;};
const identifier=(v:unknown):string=>{if(typeof v!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw new Error("REASONING_ID_INVALID");return v;};
const unknownValue=(v:unknown):boolean=>v===null||v==="unknown"||typeof v==="object"&&Object.values(v as object).some(unknownValue);
function evidenceFor(c:ReasoningContext,id:string,taskId:string):EvidenceRecord{
  const task=reasoningTasks(c).find(t=>t.task_id===taskId)!;
  const evidence=c.agent.snapshot.evidence.find(e=>e.evidence_id===id&&e.task_ids.includes(task.parent_task_id));
  if(!evidence)throw new Error("REASONING_EVIDENCE_INVALID");return evidence;
}
export function validateStructuredReasoning(raw:unknown,c:ReasoningContext):StructuredReasoningV1{return validateReasoning(raw,c,false);}
export function validatePartialStructuredReasoning(raw:unknown,c:ReasoningContext):StructuredReasoningV1{return validateReasoning(raw,c,true);}
function validateReasoning(raw:unknown,c:ReasoningContext,partial:boolean):StructuredReasoningV1{
  // Pure legacy validators remain strict unless the trusted server context
  // explicitly selects integrity mode. Never trust a model-owned mode field.
  if(c.validation_mode==="integrity"){validateReasoningContext(c);return validateIntegrityReasoning(raw,c);}
  validateReasoningContext(c);const v=object(raw);keys(v,["version","chart_hash","question_hash","findings","competing_views","unresolved_questions","overall_assessment","explainer"]);
  if(v.version!==STRUCTURED_REASONING_VERSION||v.chart_hash!==c.planner.chart_hash||v.question_hash!==c.planner.question_hash)throw new Error("REASONING_IDENTITY_INVALID");
  const tasks=reasoningTasks(c),facts=c.planner.fact_catalog.facts;
  const findings=array(v.findings,30).map(raw=>{
    const f=object(raw);keys(f,["finding_id","task_id","observation","fact_refs","evidence_ids","interpretation","status","assumptions_or_conditions","limitations"]);
    const finding_id=identifier(f.finding_id),task_id=identifier(f.task_id),task=tasks.find(t=>t.task_id===task_id);
    if(!task)throw new Error("REASONING_TASK_INVALID");
    const fact_refs=strings(f.fact_refs),evidence_ids=strings(f.evidence_ids),assumptions_or_conditions=strings(f.assumptions_or_conditions,20),limitations=strings(f.limitations,20);
    if(fact_refs.some(id=>!task.fact_refs.includes(id)||!facts.some(f=>f.fact_id===id)))throw new Error("REASONING_FACT_INVALID");
    if(f.observation!==findingObservation(c,fact_refs))throw new Error("REASONING_OBSERVATION_INVALID");
    const cited=evidence_ids.map(id=>evidenceFor(c,id,task_id));
    if(!["supported","conditional","conflicting","insufficient"].includes(String(f.status)))throw new Error("REASONING_STATUS_INVALID");
    if(f.status!=="insufficient"&&!cited.length)throw new Error("REASONING_EVIDENCE_REQUIRED");
    if(f.status==="supported"&&(!fact_refs.length||task.definitions_only||assumptions_or_conditions.length||cited.every(e=>e.kind==="case")||fact_refs.some(id=>unknownValue(facts.find(f=>f.fact_id===id)!.value))))throw new Error("REASONING_UNSUPPORTED_STRENGTH");
    if(["conditional","conflicting"].includes(String(f.status))&&!assumptions_or_conditions.length&&!limitations.length)throw new Error("REASONING_CONDITION_REQUIRED");
    if(task.definitions_only&&f.status!=="insufficient"&&!assumptions_or_conditions.length)throw new Error("REASONING_DEFINITION_ONLY");
    if(!cited.length&&!limitations.length)throw new Error("REASONING_LIMITATION_REQUIRED");
    const interpretation=reasoningText(f.interpretation);
    assertFactClaimDirections([interpretation,...assumptions_or_conditions,...limitations].join("；"),c.planner.fact_catalog);
    assertNoUnverifiedDerivation([interpretation,...assumptions_or_conditions,...limitations].join("；"));
    if(f.status==="insufficient"&&/(?<!不|未)(?:能|会|将|可以)找到(?:一份)?工作/.test(interpretation))throw new Error("REASONING_UNSUPPORTED_PREDICTION");
    return {finding_id,task_id,observation:f.observation as string,fact_refs,evidence_ids,interpretation,status:f.status as FindingStatus,assumptions_or_conditions,limitations};
  });
  if(new Set(findings.map(f=>f.finding_id)).size!==findings.length)throw new Error("REASONING_DUPLICATE_FINDING");
  if(!findings.length)throw new Error("REASONING_TASK_COVERAGE_REQUIRED");
  if(!partial)for(const task of tasks){
    const selected=findings.filter(f=>f.task_id===task.task_id);
    if(!selected.length||task.fact_refs.some(id=>!selected.some(f=>f.fact_refs.includes(id))))throw new Error("REASONING_TASK_COVERAGE_REQUIRED");
  }
  const competing_views=array(v.competing_views,20).map(raw=>{
    const row=object(raw);keys(row,["description","evidence_ids","affected_finding_ids"]);
    const evidence_ids=strings(row.evidence_ids),affected_finding_ids=strings(row.affected_finding_ids);
    if(!evidence_ids.length||!affected_finding_ids.length||evidence_ids.some(id=>!c.agent.snapshot.evidence.some(e=>e.evidence_id===id))||affected_finding_ids.some(id=>!findings.some(f=>f.finding_id===id)))throw new Error("REASONING_COMPETING_VIEW_INVALID");
    return {description:reasoningText(row.description),evidence_ids,affected_finding_ids};
  });
  for(const f of findings)if(f.status==="conflicting"&&!competing_views.some(view=>view.affected_finding_ids.includes(f.finding_id)))throw new Error("REASONING_CONFLICT_REQUIRED");
  if(!partial)for(const group of knownConflictGroups(c))if(!competing_views.some(view=>group.every(id=>view.evidence_ids.includes(id))))throw new Error("REASONING_CONFLICT_REQUIRED");
  if(!partial)for(const gap of c.agent.snapshot.unresolved_gaps)if(gap.trigger.type==="source_gap"&&gap.trigger.reason==="source_conflict"){
    const trigger=gap.trigger;
    if(!competing_views.some(view=>view.evidence_ids.includes(trigger.evidence_id)&&view.affected_finding_ids.some(id=>findings.some(f=>f.finding_id===id&&f.task_id===trigger.task_id))))throw new Error("REASONING_CONFLICT_REQUIRED");
  }
  const unresolved_questions=strings(v.unresolved_questions,100);
  if(requiredUnresolved(c).some(item=>!unresolved_questions.includes(item)))throw new Error("REASONING_GAP_OMITTED");
  const allCited=new Set([...findings.flatMap(f=>f.evidence_ids),...competing_views.flatMap(view=>view.evidence_ids)]);
  if(!partial)for(const gap of c.agent.snapshot.unresolved_gaps)if(gap.trigger.type==="source_gap"&&!allCited.has(gap.trigger.evidence_id))throw new Error("REASONING_SOURCE_GAP_OMITTED");
  // Both rounds' candidate material must be represented, not last-round-only reasoning.
  if(!partial)for(const round of [1,2])if(c.agent.snapshot.evidence.some(e=>e.rounds.includes(round))&&!c.agent.snapshot.evidence.some(e=>e.rounds.includes(round)&&allCited.has(e.evidence_id)))throw new Error("REASONING_ROUND_OMITTED");
  for(const task of tasks.filter(t=>!partial||findings.some(f=>f.task_id===t.task_id))){
    const selected=findings.filter(f=>f.task_id===task.task_id),ids=new Set(selected.flatMap(f=>f.evidence_ids));
    for(const view of competing_views)if(view.affected_finding_ids.some(id=>selected.some(f=>f.finding_id===id)))view.evidence_ids.forEach(id=>ids.add(id));
    for(const round of [1,2])if(c.agent.snapshot.evidence.some(e=>e.task_ids.includes(task.parent_task_id)&&e.rounds.includes(round))
      &&!c.agent.snapshot.evidence.some(e=>e.task_ids.includes(task.parent_task_id)&&e.rounds.includes(round)&&ids.has(e.evidence_id)))throw new Error("REASONING_TASK_ROUND_OMITTED");
  }
  if(!partial)for(const e of c.agent.snapshot.evidence)if(["definition","condition","exception"].includes(e.candidate_role)&&!allCited.has(e.evidence_id))throw new Error("REASONING_KNOWN_CONDITION_OMITTED");
  const a=object(v.overall_assessment);keys(a,["status","conclusion","reasons","limitation_notes"]);
  if(!["supported","conditional","insufficient"].includes(String(a.status))||!(a.conclusion===null||typeof a.conclusion==="string"))throw new Error("REASONING_ASSESSMENT_INVALID");
  const reasons=strings(a.reasons,20),limitation_notes=strings(a.limitation_notes,30);if(!reasons.length)throw new Error("REASONING_ASSESSMENT_INVALID");
  assertFactClaimDirections([a.conclusion??"",...reasons,...limitation_notes].join("；"),c.planner.fact_catalog);
  assertNoUnverifiedDerivation([a.conclusion??"",...reasons,...limitation_notes].join("；"));
  if(a.status==="supported"&&(requiredUnresolved(c).length||unresolved_questions.length||competing_views.length||findings.some(f=>f.status!=="supported")))throw new Error("REASONING_OVERALL_UPGRADE");
  if(a.status==="conditional"&&findings.every(f=>f.status==="insufficient"))throw new Error("REASONING_OVERALL_UPGRADE");
  if(a.status!=="supported"&&!limitation_notes.length)throw new Error("REASONING_LIMITATION_REQUIRED");
  if(a.status==="insufficient"&&a.conclusion!==null)throw new Error("REASONING_INSUFFICIENT_CONCLUSION");
  if(partial&&(a.status!=="insufficient"||a.conclusion!==null))throw new Error("REASONING_PARTIAL_CONCLUSION_FORBIDDEN");
  const result:StructuredReasoningV1={version:STRUCTURED_REASONING_VERSION,chart_hash:c.planner.chart_hash,question_hash:c.planner.question_hash,findings,competing_views,unresolved_questions,
    overall_assessment:{status:a.status as "supported"|"conditional"|"insufficient",conclusion:a.conclusion===null?null:reasoningText(a.conclusion),reasons,limitation_notes}};
  if(v.explainer!==undefined){result.explainer=validateExplainerReport(v.explainer,result,c);if(partial&&result.explainer.generation_mode!=="safe_fallback")throw new Error("REASONING_PARTIAL_CONCLUSION_FORBIDDEN");}
  return freezeAnalysis(result);
}
