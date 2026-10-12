import type { HybridEvidencePack, HybridInterpretation, LiuyaoCoreFacts, ModelAnalysisIssue, ModelUseCandidate } from "../contracts/divination";

export class ModelAnalysisValidationError extends Error {
  constructor(public readonly issues: ModelAnalysisIssue[]) {
    super("MODEL_USE_ANALYSIS_INVALID");
    this.name = "ModelAnalysisValidationError";
  }
}

function fail(code:string,path:string,message:string):never {
  throw new ModelAnalysisValidationError([{code,path,message}]);
}
function object(value:unknown,path:string,keys:string[]):Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)) fail("INVALID_OBJECT",path,"必须是对象");
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail("UNEXPECTED_FIELD",`${path}.${key}`,"不允许输出该字段");
  for (const key of keys) if (!Object.hasOwn(value,key)) fail("MISSING_FIELD",`${path}.${key}`,"缺少必需字段");
  return value as Record<string,unknown>;
}
function string(value:unknown,path:string,max=1600):string {
  if (typeof value!=="string" || !value.trim() || value.length>max) fail("INVALID_STRING",path,`必须为非空字符串，最多${max}字符`);
  return value;
}
function array(value:unknown,path:string,max=20):unknown[] {
  if (!Array.isArray(value) || value.length>max) fail("INVALID_ARRAY",path,`必须是数组，最多${max}项`);
  return value;
}
function strings(value:unknown,path:string,max=20):string[] {
  return array(value,path,max).map((v,i)=>string(v,`${path}[${i}]`));
}

export function validateModelUseAnalysis(
  content:string, pack:HybridEvidencePack, core:LiuyaoCoreFacts,
  facts:Record<string,string|number|boolean|null>, evidence:NonNullable<HybridEvidencePack["reasoning_evidence"]>,
):HybridInterpretation {
  let parsed:unknown;
  try { parsed=JSON.parse(content); } catch { fail("INVALID_JSON","$","仅输出合法JSON"); }
  const v=object(parsed,"$",["chart_hash","method_profile_id","question_understanding","candidates","selection","uncertainties","readings"]);
  const ruleIds=new Set(evidence.filter(e=>e.kind==="rule").map(e=>e.entity_revision_id));
  const allIds=new Set(evidence.map(e=>e.entity_revision_id));
  if (!ruleIds.size || !core.main_lines_complete) fail("INPUT_NOT_READY","$","缺少规则依据或完整卦盘，不得生成");
  if (v.chart_hash!==pack.chart_hash) fail("CHART_HASH_MISMATCH","$.chart_hash","必须原样返回输入哈希，不得改盘");
  if (v.method_profile_id!==pack.method_profile_id) fail("METHOD_MISMATCH","$.method_profile_id","必须原样返回方法ID");
  const cite=(value:unknown,path:string,required=true,ruleOnly=true)=>{
    const refs=strings(value,path,12), allowed=ruleOnly?ruleIds:allIds;
    if (required && !refs.length) fail("MISSING_CITATIONS",path,"必须引用本次允许的证据");
    refs.forEach((id,i)=>{
      if (!allowed.has(id)) fail(ruleOnly?"RULE_CITATION_REQUIRED":"EVIDENCE_CITATION_REQUIRED",`${path}[${i}]`,
        ruleOnly?"只允许rule_evidence中的规则ID；案例仅可在readings引用，事实字段不能作为证据ID":"只允许规则或案例ID，不能引用事实字段或其他ID");
    });
    return [...new Set(refs)];
  };
  const u=object(v.question_understanding,"$.question_understanding",["subject","relation","goal","missing_information"]);
  const question_understanding={subject:string(u.subject,"$.question_understanding.subject"),relation:string(u.relation,"$.question_understanding.relation"),goal:string(u.goal,"$.question_understanding.goal"),missing_information:strings(u.missing_information,"$.question_understanding.missing_information")};
  const seen=new Set<string>();
  const candidates:ModelUseCandidate[]=array(v.candidates,"$.candidates",8).map((value,i)=>{
    const path=`$.candidates[${i}]`;
    const c=object(value,path,["candidate_id","role","origin","line_refs","evidence_ids","reason","conditions","missing_conditions","exceptions"]);
    const candidate_id=string(c.candidate_id,`${path}.candidate_id`,80);
    if (seen.has(candidate_id)) fail("DUPLICATE_CANDIDATE",`${path}.candidate_id`,"候选ID必须唯一");
    seen.add(candidate_id);
    const role=string(c.role,`${path}.role`,30) as ModelUseCandidate["role"];
    if (!["parents","siblings","offspring","wealth","officials","self","response"].includes(role)) fail("INVALID_ROLE",`${path}.role`,"使用允许的角色枚举");
    const origin=string(c.origin,`${path}.origin`) as ModelUseCandidate["origin"];
    if (!["main","hidden","moving_transformation"].includes(origin)) fail("INVALID_ORIGIN",`${path}.origin`,"来源只能为main、hidden、moving_transformation");
    const pool=origin==="main"?core.main_lines:origin==="hidden"?core.hidden_lines:core.transformed_lines.filter(l=>core.main_lines.some(m=>m.position===l.position&&m.moving));
    const matching=pool.filter(l=>role==="self"||role==="response"?origin==="main"&&l.position_role===role:l.kin===role);
    const line_refs=strings(c.line_refs,`${path}.line_refs`,18);
    if (!line_refs.length) fail("EMPTY_CANDIDATE_LINES",`${path}.line_refs`,"无对应爻时不要创建候选，在uncertainties或readings说明该路径未发现");
    if (new Set(line_refs).size!==line_refs.length) fail("DUPLICATE_LINE",`${path}.line_refs`,"不得重复爻位");
    line_refs.forEach((ref,j)=>{if (!matching.some(l=>l.ref===ref)) fail("LINE_ORIGIN_ROLE_MISMATCH",`${path}.line_refs[${j}]`,"爻位必须真实存在、符合角色及来源；变出仅允许实际动爻对应变爻");});
    const usedFacts=new Set<string>();
    const conditions=array(c.conditions,`${path}.conditions`,15).map((value,j)=>{
      const cp=`${path}.conditions[${j}]`, x=object(value,cp,["condition","status","fact_refs","evidence_ids"]);
      const status=string(x.status,`${cp}.status`) as "met"|"not_met"|"unknown";
      if (!["met","not_met","unknown"].includes(status)) fail("INVALID_CONDITION_STATUS",`${cp}.status`,"只能为met/not_met/unknown");
      const fact_refs=strings(x.fact_refs,`${cp}.fact_refs`);
      fact_refs.forEach((ref,k)=>{if(!Object.hasOwn(facts,ref)) fail("UNKNOWN_FACT_REF",`${cp}.fact_refs[${k}]`,"字段不在fact_catalog中，不得自行构造路径");usedFacts.add(ref);});
      if (status!=="unknown" && (!fact_refs.length || fact_refs.some(ref=>facts[ref]===null))) fail("CONDITION_WITHOUT_KNOWN_FACT",`${cp}.status`,"事实缺失或为null时只能保留unknown，不能断言满足或不满足");
      return {condition:string(x.condition,`${cp}.condition`),status,fact_refs,evidence_ids:cite(x.evidence_ids,`${cp}.evidence_ids`)};
    });
    if (!conditions.length) fail("MISSING_CONDITIONS",`${path}.conditions`,"至少列出一个有依据的适用条件");
    // Values are copied only by code; the model never supplies duplicate fact values.
    const known_facts=[...usedFacts].map(fact_ref=>({fact_ref,value:facts[fact_ref]}));
    return {candidate_id,role,origin,line_refs,evidence_ids:cite(c.evidence_ids,`${path}.evidence_ids`),reason:string(c.reason,`${path}.reason`),conditions,known_facts,missing_conditions:strings(c.missing_conditions,`${path}.missing_conditions`),exceptions:strings(c.exceptions,`${path}.exceptions`)};
  });
  const s=object(v.selection,"$.selection",["candidate_id","line_ref","evidence_ids","reason"]);
  const unresolved=s.candidate_id===null&&s.line_ref===null;
  if ((s.candidate_id===null)!==(s.line_ref===null)) fail("PARTIAL_SELECTION","$.selection","未选定时candidate_id与line_ref必须同时为空");
  const selection:NonNullable<HybridInterpretation["analysis"]>["selection"]={candidate_id:null,line_ref:null,evidence_ids:cite(s.evidence_ids,"$.selection.evidence_ids",!unresolved),reason:string(s.reason,"$.selection.reason")};
  if (!unresolved) {
    const id=string(s.candidate_id,"$.selection.candidate_id"),ref=string(s.line_ref,"$.selection.line_ref");
    const c=candidates.find(c=>c.candidate_id===id);
    if (!c || !c.line_refs.includes(ref)) fail("SELECTION_NOT_IN_CANDIDATE","$.selection","必须选已有候选及其爻位");
    if (!pack.interpretation_contract.model_selection_allowed) fail("SELECTION_NOT_ALLOWED","$.selection","当前权限不允许选定");
    if (question_understanding.missing_information.length || c.missing_conditions.length || c.conditions.some(x=>x.status!=="met")) fail("UNRESOLVED_SELECTION","$.selection","有关键缺失或条件未知/不满足，必须保留未选定");
    if (!c.known_facts.some(f=>f.fact_ref.startsWith(ref+"."))) fail("SELECTED_LINE_FACT_REQUIRED","$.selection.line_ref","候选条件需引用所选爻的真实属性");
    if (selection.evidence_ids.some(id=>!c.evidence_ids.includes(id))) fail("SELECTION_CITATION_NOT_IN_CANDIDATE","$.selection.evidence_ids","选用引用必须是候选规则引用的子集");
    const usedIds=new Set([...c.evidence_ids,...selection.evidence_ids,...c.conditions.flatMap(x=>x.evidence_ids)]);
    if (evidence.some(e=>usedIds.has(e.entity_revision_id)&&(e.conflict_group_ids.length||e.condition_evaluation==="false"))) fail("CONFLICTING_SELECTION","$.selection","不得依据争议或不适用规则唯一选定");
    selection.candidate_id=id;selection.line_ref=ref;
  }
  const uncertainties=strings(v.uncertainties,"$.uncertainties");
  if (!candidates.length && !uncertainties.length) fail("EMPTY_ANALYSIS_REASON_REQUIRED","$.uncertainties","无候选时需说明证据或盘面缺失");
  const readings=array(v.readings,"$.readings",8).map((value,i)=>{
    const path=`$.readings[${i}]`,r=object(value,path,["text","evidence_ids"]);
    return {text:string(r.text,`${path}.text`,1200),evidence_ids:cite(r.evidence_ids,`${path}.evidence_ids`,true,false)};
  });
  if (!readings.length) fail("MISSING_READINGS","$.readings","至少一段有引用的有限解释");
  return {status:"generated",readings,analysis:{question_understanding,candidates,selection,uncertainties},validation:"references_and_core_facts",message:"以下为模型依据原文作出的候选用神分析；已校验引用与结构化盘面事实，未由规则引擎证明取用正确。"};
}
