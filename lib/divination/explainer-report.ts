import type { ReasoningContext, StructuredReasoningV1 } from "./structured-reasoning";
import type { BuiltReasoningInput } from "./reasoning-input";
import { analysisHash, canonicalAnalysis, freezeAnalysis } from "./analysis-utils";
import { assertFactClaimDirections, assertNoUnverifiedDerivation } from "./fact-claim-guard";
import { TOPICS, type TopicId } from "./topic-taxonomy";
import { plannerFactDescription } from "./planner-description";

export const EXPLAINER_VERSION="evidence-explainer-v1.3";
export class ExplainerValidationError extends Error {
  readonly issues:{code:string;path:string}[];
  constructor(code:string,path:string){super(code);this.issues=[{code,path}];}
}
export type ClaimStrength="supported"|"conditional"|"insufficient";
export interface RuleApplication {
  evidence_links:{evidence_id:string;topic_id:TopicId;quote:string;use:"supports"|"limits"|"background"|"contradicts";relevance:string}[];
  conditions:{description:string;state:"met"|"unmet"|"unknown";fact_refs:string[];expected_value?:unknown}[];
  exceptions_checked:string[];
  applicability:"applicable"|"conditional"|"inapplicable"|"insufficient";
}
export interface InterpretationClaim {
  claim_id:string;kind:"structural"|"rule_application"|"synthesis"|"practical";
  scope:"local"|"outcome"|"timing";strength:ClaimStrength;text:string;basis_task_ids:string[];
  basis_finding_ids:string[];fact_refs:string[];evidence_ids:string[];rule_application:RuleApplication|null;
}
export interface ExplainerCitation {number:number;evidence_id:string;title:string;source_revision_id:string;locator:string;quote:string;url?:string}
export interface ExplainerReport {
  validation_mode?:"integrity"|"strict";
  generation_mode:"model"|"safe_fallback";
  version:typeof EXPLAINER_VERSION;claims:InterpretationClaim[];
  sections:{verdict:string[];advice:string[];analysis:string[]};
  gap_impacts:{gap_id:string;classification:"core"|"time"|"secondary";affected_claim_ids:string[];reason:string}[];
  limitations:string[];citations:ExplainerCitation[];
}
const error=(code:string):never=>{throw new Error(`REASONING_EXPLAINER_${code}`);};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))return error("SCHEMA_INVALID");return v as Record<string,unknown>;};
const keys=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))error("SCHEMA_INVALID");};
const array=(v:unknown,max=30):unknown[]=>{if(!Array.isArray(v)||v.length>max)return error("SCHEMA_INVALID");return v;};
const string=(v:unknown,max=600):string=>{if(typeof v!=="string"||!v.trim()||v.length>max)return error("SCHEMA_INVALID");return v;};
const strings=(v:unknown,max=30)=>{const a=array(v,max).map(x=>string(x));if(new Set(a).size!==a.length)error("DUPLICATE_REFERENCE");return a;};
const enumeration=<T extends string>(v:unknown,values:readonly T[]):T=>{if(!values.includes(v as T))return error("SCHEMA_INVALID");return v as T;};
const unknown=(v:unknown):boolean=>v===null||v==="unknown"||typeof v==="object"&&Object.values(v as object).some(unknown);
function prose(v:unknown,c:ReasoningContext,max=600){
  const s=string(v,max);assertFactClaimDirections(s,c.planner.fact_catalog);assertNoUnverifiedDerivation(s);
  if(/一定会|必然会|必定会|必吉|必凶|注定|保证成功|保证失败|\d+\s*[%％]|无需就医|停止服药/.test(s))error("UNSUPPORTED_STRENGTH");
  const affirmative=s.split(/[。；]/).filter(clause=>!/(?:不代表|不能.{0,4}(?:说明|证明|推定|推断)|不得.{0,4}推断)/.test(clause)).join("；");
  if(/(?:表明|说明|证明)[^。；]{0,16}(?:求职意愿|已(?:有|经)?行动|心理|焦虑)|(?:你|求测者)[^。；]{0,8}(?:很想|已经行动|能力不足)|求职意愿强|主观上积极|行动方向正确|信心缺失/.test(affirmative))error("UNSUPPORTED_PSYCHOLOGY");
  if(/月破[^。；]{0,45}(?:月旺|月令.{0,8}旺|旺.{0,4}标签)[^。；]{0,16}(?:冲突|矛盾)/.test(s)&&!/(?:不是|不构成|不自动|不能.{0,8}(?:视为|称为|认定))/.test(s))error("FALSE_CONFLICT");
  if(/\b(?:T\d+|EXT_\d+|supported|conditional|insufficient)\b|无新增事实|此任务/.test(s))error("INTERNAL_LANGUAGE");
  return s;
}
// A topic/quote match checks routing relevance, NOT logical entailment. The
// explicit application assessment and human review remain necessary.
const anchors:Partial<Record<TopicId,RegExp>>={generation_restriction:/生|克/,self_response:/世|應|应/,advance_retreat:/進神|进神|退神|化退|化進|化进/,moving_line:/動|动|靜|静/,transformation:/化|變|变/,timing:/應期|应期|時|时|日|月/};
export function evidenceCitation(c:ReasoningContext,evidenceId:string,number:number):ExplainerCitation{
  const e=c.agent.snapshot.evidence.find(e=>e.evidence_id===evidenceId);if(!e)return error("EVIDENCE_INVALID");
  let title="典籍名称未提供",url:string|undefined;
  for(const round of c.agent.snapshot.retrieval_history)for(const unit of round.pack.reasoning_evidence??[]){
    const q=unit.source_quotes.find(q=>q.source_revision_id===e.source_revision_id&&q.quote_hash===e.quote_hash);
    if(!q)continue;
    // Existing source-reading adapter supplies title + newline + exact quote.
    const prefix=unit.summary.endsWith(q.quote)?unit.summary.slice(0,-q.quote.length).trim():"";
    if(prefix&&prefix.length<=100&&!prefix.includes("\n"))title=prefix;
    if(q.url&&/^https?:\/\//.test(q.url))url=q.url;
  }
  return {number,evidence_id:e.evidence_id,title,source_revision_id:e.source_revision_id,
    locator:`原文字符 ${e.start_offset}–${e.end_offset_exclusive}（Unicode codepoint）`,quote:e.text,...(url?{url}:{})};
}

/** Compiles model claims or revalidates a persisted report against actual evidence.
 * It never treats a nonempty ID array as proof of the interpretation. */
export function validateExplainerReport(raw:unknown,r:StructuredReasoningV1,c:ReasoningContext,aliases?:Pick<BuiltReasoningInput,"factIds"|"evidenceIds">):ExplainerReport{
  if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
    const sections=(raw as Record<string,unknown>).sections;
    if(sections&&typeof sections==="object"&&!Array.isArray(sections)&&Array.isArray((sections as Record<string,unknown>).verdict)&&typeof ((sections as Record<string,unknown>).verdict as unknown[])[0]==="object")raw=expandExplainerDraft(raw,r,c,aliases);
  }
  const v=object(raw);keys(v,["version","generation_mode","claims","sections","gap_impacts","limitations","citations"]);
  const generation_mode=v.generation_mode===undefined?"model":enumeration(v.generation_mode,["model","safe_fallback"] as const);
  if(v.version!==undefined&&v.version!==EXPLAINER_VERSION)error("VERSION_INVALID");
  const factId=(s:string)=>aliases?.factIds[s]??s,evidenceId=(s:string)=>aliases?.evidenceIds[s]??s;
  const claims=array(v.claims,16).map((raw,index)=>{
    try{
    const row=object(raw);keys(row,["claim_id","kind","scope","strength","text","basis_task_ids","basis_finding_ids","fact_refs","evidence_ids","rule_application"]);
    const claim_id=string(row.claim_id,64);if(!/^[A-Za-z0-9_-]+$/.test(claim_id))error("ID_INVALID");
    const kind=enumeration(row.kind,["structural","rule_application","synthesis","practical"] as const),scope=enumeration(row.scope,["local","outcome","timing"] as const);
    const strength=enumeration(row.strength,["supported","conditional","insufficient"] as const),text=prose(row.text,c);
    const basis_task_ids=strings(row.basis_task_ids),basis=r.findings.filter(f=>basis_task_ids.includes(f.task_id));
    if(basis_task_ids.some(id=>!r.findings.some(f=>f.task_id===id)))error("BASIS_INVALID");
    const basis_finding_ids=basis.map(f=>f.finding_id),fact_refs=strings(row.fact_refs).map(factId);
    if(fact_refs.some(id=>!basis.some(f=>f.fact_refs.includes(id))))error("FACT_INVALID");
    let rule_application:RuleApplication|null=null;
    if(kind==="practical"){
      if(basis_task_ids.length||fact_refs.length||row.rule_application!==null||scope!=="local"||strength!=="insufficient")error("PRACTICAL_DISGUISED");
      if(/吉日|择日|擇日|开运|開運|幸运|幸運|风水|風水|服药|停药|买入|卖出|杠杆/.test(text))error("PRACTICAL_DISGUISED");
      if(/世爻|用神|官鬼|月破|旬空|动爻|變爻|变爻|五行|卦象|进神|退神|卦理/.test(text))error("PRACTICAL_DISGUISED");
    }else if(!basis.length||!fact_refs.length&&scope!=="timing")error("BASIS_INVALID");
    if(kind==="structural"){
      if(row.rule_application!==null||scope!=="local")error("STRUCTURAL_UPGRADE");
      // Structural prose must only reformat program observations; no theoretical
      // interpretation can evade evidence by declaring itself structural.
      if(text!==basis.filter(f=>f.fact_refs.some(id=>fact_refs.includes(id))).map(f=>f.observation).join("；"))error("STRUCTURAL_UPGRADE");
    }
    if(kind==="rule_application"||kind==="synthesis"){
      const a=object(row.rule_application);keys(a,["evidence_links","conditions","exceptions_checked","applicability"]);
      const applicability=enumeration(a.applicability,["applicable","conditional","inapplicable","insufficient"] as const);
      const allowedTopics=new Set(basis.flatMap(f=>{
        const parent=c.planner.initial_plan.tasks.find(t=>t.task_id===f.task_id)??c.planner.initial_plan.tasks.find(t=>c.agent.supplemental_tasks.some(s=>s.extension_id===f.task_id&&s.parent_task_id===t.task_id));
        return parent?.topic_ids??[];
      }));
      const evidence_links=array(a.evidence_links,16).map(raw=>{
        const link=object(raw);keys(link,["evidence_id","topic_id","quote","use","relevance"]);
        const evidence_id=evidenceId(string(link.evidence_id)),e=c.agent.snapshot.evidence.find(e=>e.evidence_id===evidence_id);
        if(!e||!basis.some(f=>f.evidence_ids.includes(evidence_id)))return error("EVIDENCE_INVALID");
        const topic_id=string(link.topic_id) as TopicId;if(!Object.hasOwn(TOPICS,topic_id)||!allowedTopics.has(topic_id))error("TOPIC_INVALID");
        // Exact original text is program-owned. New model outputs select the
        // evidence; explicit excerpts from older clients must still match exactly.
        const quote=link.quote===undefined?e.text:string(link.quote,Math.max(1200,e.text.length));if(quote.length<8||!e.text.includes(quote))error("QUOTE_INVALID");
        const use=enumeration(link.use,["supports","limits","background","contradicts"] as const),relevance=prose(link.relevance,c,300);
        if(!((anchors[topic_id]?.test(quote))||TOPICS[topic_id].terms.some(t=>quote.includes(t))))error("IRRELEVANT_QUOTE");
        if(use==="supports"&&e.kind==="case")error("CASE_UPGRADE");
        if(use==="supports"&&/(?:應|应)[為为]用神/.test(quote)&&c.planner.use_roles.primary?.role!=="response")error("RULE_ROLE_MISMATCH");
        return {evidence_id,topic_id,quote,use,relevance};
      });
      if(!evidence_links.length)error("EVIDENCE_REQUIRED");
      const conditions=array(a.conditions,12).map(raw=>{
        const condition=object(raw);keys(condition,["description","state","fact_refs","expected_value"]);
        const description=prose(condition.description,c,240),state=enumeration(condition.state,["met","unmet","unknown"] as const),refs=strings(condition.fact_refs).map(factId);
        if(refs.some(id=>!fact_refs.includes(id)))error("CONDITION_FACT_INVALID");
        if(state!=="unknown"){
          if(!refs.length||!Object.hasOwn(condition,"expected_value"))error("CONDITION_UNVERIFIED");
          for(const ref of refs){const f=c.planner.fact_catalog.facts.find(f=>f.fact_id===ref);if(!f||unknown(f.value)||(canonicalAnalysis(f.value)===canonicalAnalysis(condition.expected_value))!==(state==="met"))error("CONDITION_UNVERIFIED");}
        }
        return {description,state,fact_refs:refs,...(Object.hasOwn(condition,"expected_value")?{expected_value:condition.expected_value}:{})};
      });
      const exceptions_checked=strings(a.exceptions_checked,8).map(x=>prose(x,c,240));
      if(!conditions.length||!exceptions_checked.length)error("APPLICATION_REQUIRED");
      if(applicability==="applicable"&&(conditions.some(x=>x.state!=="met")||!evidence_links.some(x=>x.use==="supports")))error("APPLICATION_UPGRADE");
      if(conditions.some(x=>x.state==="unmet")&&!["inapplicable","insufficient"].includes(applicability))error("APPLICATION_UPGRADE");
      if(strength==="supported"&&(applicability!=="applicable"||basis.some(f=>f.status!=="supported")))error("UNSUPPORTED_STRENGTH");
      if(strength==="conditional"&&!["applicable","conditional"].includes(applicability))error("APPLICATION_UPGRADE");
      if(strength==="conditional"&&basis.every(f=>f.status==="insufficient"))error("UNSUPPORTED_STRENGTH");
      rule_application={evidence_links,conditions,exceptions_checked,applicability};
    }
    const evidence_ids=[...new Set(rule_application?.evidence_links.map(l=>l.evidence_id)??[])];
    if(row.evidence_ids!==undefined&&canonicalAnalysis(row.evidence_ids)!==canonicalAnalysis(evidence_ids))error("EVIDENCE_INVALID");
    if(row.basis_finding_ids!==undefined&&canonicalAnalysis(row.basis_finding_ids)!==canonicalAnalysis(basis_finding_ids))error("BASIS_INVALID");
    return {claim_id,kind,scope,strength,text,basis_task_ids,basis_finding_ids,fact_refs,evidence_ids,rule_application};
    }catch(error){throw new ExplainerValidationError(error instanceof Error?error.message:"REASONING_EXPLAINER_SCHEMA_INVALID",`explainer.claims[${index}]`);}
  });
  if(!claims.length||new Set(claims.map(x=>x.claim_id)).size!==claims.length)error("DUPLICATE_REFERENCE");
  const section=object(v.sections);keys(section,["verdict","advice","analysis"]);
  const sections={verdict:strings(section.verdict,3),advice:strings(section.advice,3),analysis:strings(section.analysis,6)};
  if(!sections.verdict.length||!sections.analysis.length)error("SECTION_REQUIRED");
  const selected=Object.values(sections).flat();if(selected.some(id=>!claims.some(c=>c.claim_id===id))||new Set(selected).size!==selected.length||selected.length!==claims.length)error("SECTION_INVALID");
  if(sections.verdict.some(id=>{const claim=claims.find(c=>c.claim_id===id)!;return claim.kind!=="synthesis"||claim.scope!=="outcome";}))error("VERDICT_INVALID");
  if(sections.verdict.some(id=>claims.find(c=>c.claim_id===id)!.strength!==r.overall_assessment.status))error("VERDICT_UPGRADE");
  if(sections.analysis.some(id=>claims.find(c=>c.claim_id===id)!.kind==="practical"))error("PRACTICAL_DISGUISED");
  const gap_impacts=array(v.gap_impacts,100).map(raw=>{
    const g=object(raw);keys(g,["gap_id","classification","affected_claim_ids","reason"]);
    const gap_id=string(g.gap_id),gap=c.agent.snapshot.unresolved_gaps.find(g=>g.gap_id===gap_id);if(!gap)return error("GAP_INVALID");
    const parent=c.planner.initial_plan.tasks.find(t=>t.task_id===gap.trigger.task_id);
    const expected=parent?.kind==="timing"?"time":parent?.priority==="optional"?"secondary":"core";
    const classification=enumeration(g.classification,["core","time","secondary"] as const);
    if(classification!==expected)error("GAP_DOWNGRADE");
    const affected_claim_ids=strings(g.affected_claim_ids);if(!affected_claim_ids.length||affected_claim_ids.some(id=>!claims.some(c=>c.claim_id===id)))error("GAP_INVALID");
    const affected=claims.filter(claim=>claim.basis_task_ids.includes(gap.trigger.task_id)||classification==="core"&&claim.scope==="outcome"||classification==="time"&&claim.scope==="timing");
    if(affected.some(claim=>!affected_claim_ids.includes(claim.claim_id)))error("GAP_OMITTED");
    if(affected_claim_ids.some(id=>claims.find(claim=>claim.claim_id===id)!.strength==="supported"))error("GAP_UPGRADE");
    return {gap_id,classification,affected_claim_ids,reason:prose(g.reason,c,300)};
  });
  if(c.agent.snapshot.unresolved_gaps.some(g=>!gap_impacts.some(i=>i.gap_id===g.gap_id))||new Set(gap_impacts.map(g=>g.gap_id)).size!==gap_impacts.length)error("GAP_OMITTED");
  if(claims.some(claim=>claim.scope==="outcome"&&claim.strength==="supported"&&(r.overall_assessment.status!=="supported"||c.agent.snapshot.errors.length)))error("UNSUPPORTED_STRENGTH");
  const limitations=strings(v.limitations,3).map(x=>prose(x,c,240));
  const citationIds=[...new Set(claims.flatMap(claim=>claim.evidence_ids))],citations=citationIds.map((id,i)=>evidenceCitation(c,id,i+1));
  if(v.citations!==undefined&&analysisHash(v.citations)!==analysisHash(citations))error("CITATION_INVALID");
  if(generation_mode==="safe_fallback"&&claims.some(claim=>claim.strength!=="insufficient"))error("UNSUPPORTED_STRENGTH");
  return freezeAnalysis({version:EXPLAINER_VERSION,generation_mode,claims,sections,gap_impacts,limitations,citations});
}

/** Production model schema: prose + selected evaluated sources only. Identity,
 * task facts, strength bounds, sections and gap impact are program-owned. */
export function expandExplainerDraft(raw:unknown,r:StructuredReasoningV1,c:ReasoningContext,aliases?:Pick<BuiltReasoningInput,"factIds"|"evidenceIds">){
  const v=object(raw);keys(v,["sections","limitations"]);
  const s=object(v.sections);keys(s,["verdict","advice","analysis"]);
  const claims:Omit<InterpretationClaim,"basis_finding_ids"|"evidence_ids">[]=[],sections={verdict:[] as string[],advice:[] as string[],analysis:[] as string[]};
  for(const section of ["verdict","advice","analysis"] as const)for(const draft of array(section==="advice"?(s[section]??[]):s[section],section==="verdict"?1:section==="advice"?3:5)){
    const row=object(draft);keys(row,["text","basis_task_ids","evidence_links","conditions","exceptions_checked","practical"]);
    const claim_id=`C${claims.length+1}`,text=prose(row.text,c),practical=row.practical===true;
    if(practical&&section!=="advice")error("PRACTICAL_DISGUISED");
    if(practical){
      if(Object.keys(row).some(key=>!["text","practical"].includes(key)))error("PRACTICAL_DISGUISED");
      claims.push({claim_id,kind:"practical",scope:"local",strength:"insufficient",text,basis_task_ids:[],fact_refs:[],rule_application:null});
    }else{
      const basis_task_ids=strings(row.basis_task_ids),basis=r.findings.filter(f=>basis_task_ids.includes(f.task_id));
      if(!basis.length||basis_task_ids.some(id=>!basis.some(f=>f.task_id===id)))error("BASIS_INVALID");
      const fact_refs=[...new Set(basis.flatMap(f=>f.fact_refs))];
      const timing=basis.some(f=>c.planner.initial_plan.tasks.some(t=>t.task_id===f.task_id&&t.kind==="timing")||c.agent.supplemental_tasks.some(t=>t.extension_id===f.task_id&&t.topic_ids.includes("timing")));
      const strength=section==="verdict"?r.overall_assessment.status:basis.every(f=>f.status==="insufficient")?"insufficient":"conditional";
      const conditions=strings(row.conditions,8).map(description=>({description,state:"unknown" as const,fact_refs:[] as string[]}));
      if(!conditions.length)error("APPLICATION_REQUIRED");
      const evidence_links=array(row.evidence_links,8).map(raw=>{
        const link=object(raw);keys(link,["evidence_id","topic_id","use","relevance"]);
        const id=string(link.evidence_id),evidence_id=aliases?.evidenceIds[id]??id;
        const e=c.agent.snapshot.evidence.find(e=>e.evidence_id===evidence_id);if(!e)return error("EVIDENCE_INVALID");
        return {evidence_id,topic_id:string(link.topic_id) as TopicId,use:enumeration(link.use,["supports","limits","background","contradicts"] as const),relevance:prose(link.relevance,c,300),quote:e.text};
      });
      claims.push({claim_id,kind:section==="verdict"?"synthesis":"rule_application",scope:section==="verdict"?"outcome":timing?"timing":"local",strength,text,basis_task_ids,fact_refs,
        rule_application:{evidence_links,conditions,exceptions_checked:strings(row.exceptions_checked,8),applicability:strength==="insufficient"?"insufficient":"conditional"}});
    }
    sections[section].push(claim_id);
  }
  const gap_impacts=c.agent.snapshot.unresolved_gaps.map(g=>{
    const parent=c.planner.initial_plan.tasks.find(t=>t.task_id===g.trigger.task_id);
    const classification=parent?.kind==="timing"?"time":parent?.priority==="optional"?"secondary":"core";
    const affected=claims.filter(claim=>claim.kind!=="practical"&&(claim.basis_task_ids.includes(g.trigger.task_id)||classification==="core"&&claim.scope==="outcome"||classification==="time"&&claim.scope==="timing"));
    // If no report claim establishes independence from a gap, conservatively
    // retain its influence on the verdict instead of silently discarding it.
    return {gap_id:g.gap_id,classification,affected_claim_ids:(affected.length?affected:claims.filter(claim=>claim.scope==="outcome")).map(claim=>claim.claim_id),reason:`${g.description}；此项仍待核验，影响所关联判断，不据此升级确定性。`};
  });
  return {claims,sections,gap_impacts,limitations:strings(v.limitations,3)};
}

/** Safe partial presentation: uses only verified observations and labels every
 * source as background/limitation, never reuses failed model report prose. */
export function conservativeExplainer(r:StructuredReasoningV1,c:ReasoningContext):ExplainerReport|undefined{
  const analysis:Record<string,unknown>[]=[];
  const endings:Record<string,string>={role_condition:"上述角色沿用程序结果。原文取用前提尚未核对一致，不能直接套作本问的吉凶依据。",month_day_effect:"这些是不同层次的局部信息。实际作用须核验规则，不能据此直接推出综合旺衰。",moving_transformation:"本变关系已经冻结；进退神分类与实际效力仍未核定。",line_relationship:"这只是结构方向，不等于实际生助已成立，也不直接等同现实行为或成败。",hidden_condition:"位置信息不等于可用性或出伏已经成立，仍须核验具体规则。",timing:"原始期限保持不变，现有材料尚未建立相应应期规则，不推断具体日期。"};
  for(const task of c.planner.initial_plan.tasks){
    const finding=r.findings.find(f=>f.task_id===task.task_id);if(!finding)continue;
    const links=finding.evidence_ids.flatMap(id=>{
      const e=c.agent.snapshot.evidence.find(e=>e.evidence_id===id)!;
      const topic_id=task.topic_ids.find(t=>anchors[t]?.test(e.text)||TOPICS[t].terms.some(term=>e.text.includes(term)));
      if(!topic_id||e.text.length<8)return [];
      return [{evidence_id:id,topic_id,use:"background",relevance:/(?:應|应)[為为]用神/.test(e.text)&&c.planner.use_roles.primary?.role!=="response"?"此段以应为用神，与本问程序角色不同，不直接套用，只保留为资料局限的记录。":"仅保留与任务相关的原文；适用条件尚未核定，不作为当前吉凶结论的支持。"}];
    }).slice(0,2);
    if(!links.length)continue;
    const descriptions=c.planner.fact_catalog.facts.filter(f=>finding.fact_refs.includes(f.fact_id)).map(f=>plannerFactDescription(f,c.planner.fact_catalog,c.frozen?.cast.core_facts)).join("；").slice(0,330).replace(/requires_rule_evaluation/g,"待规则核验").replace(/unknown/g,"未知");
    analysis.push({text:task.kind==="timing"?`问事时间要求为“${c.planner.question_analysis.time_constraint?.expression??"何时发生"}”。${endings.timing}`:`${descriptions}。${endings[task.kind]}`,basis_task_ids:[task.task_id],evidence_links:links,conditions:["原文对本问的具体适用条件尚未完成核验。"],exceptions_checked:["未确认例外已排除；不借缺失信息补造规则或结论。"]});
  }
  if(!analysis.length)return;
  const selected=analysis.slice(0,5),basis_task_ids=[...new Set(selected.flatMap(a=>a.basis_task_ids as string[]))];
  const report=expandExplainerDraft({sections:{
    verdict:[{text:"本次为部分分析。针对已确认问事，目前尚不能作出成败与期限内结果的判断。可以确认角色、盘面状态及动变关系，但相关理论的适用条件尚未形成完整依据。下文保留已核对的结构和解释边界；不能确定，并不等于判断事情不会发生。",basis_task_ids,evidence_links:(selected.flatMap(a=>a.evidence_links as unknown[])).slice(0,8),conditions:["主要理论适用条件及期限推断仍待核验。"],exceptions_checked:["没有将未核验的例外视为已排除。"]}],
    advice:c.planner.question_analysis.domain==="career"&&c.planner.question_analysis.event_type==="new_job"?[{practical:true,text:"继续按目标岗位要求准备申请材料，并记录投递与面试反馈。"},{practical:true,text:"根据招聘方的实际回复调整计划，重要安排以可核实信息为准。"}]:[{practical:true,text:"根据已核实的现实信息安排下一步，不把这份分析当作结果保证。"}],analysis:selected},limitations:["本次仅保留经过程序验证的结构和证据目录，尚未形成完整的理论适用判断。"]},r,c);
  const claims=report.claims.map(claim=>({...claim,strength:"insufficient",rule_application:claim.rule_application?{...claim.rule_application,applicability:"insufficient"}:null}));
  return validateExplainerReport({...report,claims,generation_mode:"safe_fallback"},r,c);
}
