import type { DivinationModernInterpretation } from "../contracts/divination";
import { analysisHash, freezeAnalysis } from "./analysis-utils";
import type { StructuredReasoningV1 } from "./structured-reasoning";

export const REASONING_TEXT_VERSION="reasoning-text-v1";
export interface ReasoningTextV1 {
  version:typeof REASONING_TEXT_VERSION;reasoning_hash:string;assessment_status:"supported"|"conditional"|"insufficient";
  paragraphs:{finding_id:string;status:string;text:string;evidence_ids:string[]}[];
  report_hash?:string;
}
export const REASONING_DISCLAIMER="本解释仅为传统六爻体系内的文化参考，不是对未来事实的科学证明，不构成医疗、法律、投资等专业建议。";
export function validateReasoningText(raw:unknown,r:StructuredReasoningV1):ReasoningTextV1{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("WRITING_SCHEMA_INVALID");
  const v=raw as ReasoningTextV1;
  if(r.explainer){
    if(Object.keys(v).some(k=>!["version","reasoning_hash","assessment_status","paragraphs","report_hash"].includes(k))||v.version!==REASONING_TEXT_VERSION||v.reasoning_hash!==analysisHash(r)||v.assessment_status!==r.overall_assessment.status||v.report_hash!==analysisHash(r.explainer)||!Array.isArray(v.paragraphs)||v.paragraphs.length)throw new Error("WRITING_REPORT_CHANGED");
    return freezeAnalysis(structuredClone(v));
  }
  if(Object.keys(v).some(k=>!["version","reasoning_hash","assessment_status","paragraphs"].includes(k))||v.version!==REASONING_TEXT_VERSION||v.reasoning_hash!==analysisHash(r)||v.assessment_status!==r.overall_assessment.status
    ||!Array.isArray(v.paragraphs)||v.paragraphs.length!==r.findings.length)throw new Error("WRITING_IDENTITY_INVALID");
  const ids=new Set<string>();
  for(const p of v.paragraphs){
    if(!p||Object.keys(p).some(k=>!["finding_id","status","text","evidence_ids"].includes(k)))throw new Error("WRITING_SCHEMA_INVALID");
    const finding=r.findings.find(f=>f.finding_id===p.finding_id);
    if(!finding||ids.has(p.finding_id)||p.status!==finding.status||p.text!==finding.interpretation||!Array.isArray(p.evidence_ids)||analysisHash([...p.evidence_ids].sort())!==analysisHash([...finding.evidence_ids].sort()))throw new Error("WRITING_FINDING_CHANGED");
    ids.add(p.finding_id);
  }
  return freezeAnalysis(structuredClone(v));
}
export function reasoningTextTemplate(r:StructuredReasoningV1):ReasoningTextV1{return {version:REASONING_TEXT_VERSION,reasoning_hash:analysisHash(r),assessment_status:r.overall_assessment.status,
  ...(r.explainer?{report_hash:analysisHash(r.explainer)}:{}),paragraphs:r.explainer?[]:r.findings.map(f=>({finding_id:f.finding_id,status:f.status,text:f.interpretation,evidence_ids:[...f.evidence_ids]}))};}
// The writer chooses order, not new judgments. Server projection preserves ALL
// observations, conditions, competing views and limitations, even on shorter prose.
export function renderReasoningText(text:ReasoningTextV1,r:StructuredReasoningV1):DivinationModernInterpretation{
  validateReasoningText(text,r);
  if(r.explainer){
    const report=r.explainer;
    const paragraph=(id:string)=>{const claim=report.claims.find(c=>c.claim_id===id)!;return `${claim.kind==="practical"?"现实建议：":""}${claim.text}${claim.evidence_ids.map(id=>`[${report.citations.find(c=>c.evidence_id===id)!.number}]`).join("")}`;};
    const blocks=["断语",...report.sections.verdict.map(paragraph),...(report.sections.advice.length?["行动建议",...report.sections.advice.map(paragraph)]:[]),"卦理分析",...report.sections.analysis.map(paragraph),...(report.limitations.length?[`必要限制：${report.limitations.join("；")}`]:[])];
    return {overall_interpretation:blocks.join("\n\n"),readings:[],contextual_reflections:report.claims.filter(c=>c.evidence_ids.length).map(c=>({text:c.text,evidence_ids:c.evidence_ids})),uncertainties:[...new Set([...r.unresolved_questions,...r.overall_assessment.limitation_notes,...r.findings.flatMap(f=>[...f.assumptions_or_conditions,...f.limitations])])],disclaimer:REASONING_DISCLAIMER,explainer:report};
  }
  const status={supported:"在选定传统理论体系内有依据",conditional:"当前只能作有条件的传统解释",insufficient:"当前证据不足，无法得出明确的传统判断"};
  const paragraphs=text.paragraphs.map(p=>{
    const f=r.findings.find(f=>f.finding_id===p.finding_id)!;
    return [p.text,...(f.assumptions_or_conditions.length?[`条件与待核验项：${[...new Set(f.assumptions_or_conditions)].join("；")}`]:[]),...(f.limitations.some(x=>!f.assumptions_or_conditions.includes(x))?[`限制：${[...new Set(f.limitations.filter(x=>!f.assumptions_or_conditions.includes(x)))].join("；")}`]:[])].join("\n");
  });
  const uncertainties=[...new Set([...r.unresolved_questions,...r.overall_assessment.limitation_notes,...r.findings.flatMap(f=>[...f.assumptions_or_conditions,...f.limitations])])];
  return {overall_interpretation:["断语",r.overall_assessment.conclusion??status[r.overall_assessment.status],"行动建议","暂无经完整证据链核验的卦理建议；现实安排应结合可核实信息。","卦理分析",...paragraphs].filter(Boolean).join("\n\n"),readings:[],
    contextual_reflections:text.paragraphs.filter(p=>p.evidence_ids.length).map(p=>({text:p.text,evidence_ids:[...p.evidence_ids]})),uncertainties,disclaimer:REASONING_DISCLAIMER};
}
