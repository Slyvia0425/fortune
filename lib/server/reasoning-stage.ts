import { analysisHash } from "../divination/analysis-utils";
import { traceNode } from "./case-trace";
import { validateStructuredReasoning, validatePartialStructuredReasoning, validateReasoningContext, STRUCTURED_REASONING_VERSION, type ReasoningContext, type StructuredReasoningV1 } from "../divination/structured-reasoning";
import { renderReasoningText, reasoningTextTemplate, validateReasoningText, type ReasoningTextV1 } from "../divination/reasoning-text";
import type { DivinationModernInterpretation } from "../contracts/divination";
import { synthesizeStructuredReasoning, writeReasoningText, reasoningProfile, WRITING_PROMPT, WRITING_PROMPT_VERSION } from "./structured-reasoning-llm";
import { analysisModelProfile } from "./divination-llm";
import { reasoningStageStore, type ReasoningStageStore } from "./reasoning-stage-store";
import { REASONING_INPUT_VERSION } from "../divination/reasoning-input";
import { FACT_CLAIM_GUARD_VERSION } from "../divination/fact-claim-guard";
import { EXPLAINER_VERSION,conservativeExplainer } from "../divination/explainer-report";
import { reasoningMode } from "./reasoning-config";
import { FULL_REASONING_VERSION } from "../divination/full-reasoning";

export const REASONING_STAGE_VERSION="structured-stage-mode-isolated-v5";
export interface ReasoningDiagnostic {stage:"reasoning"|"writing"|"checkpoint"|"identity";code:string;attempts:number;diagnostic_run_id?:string;failure_kind?:string;presentation_code?:string}
export interface ReasoningStageResult {
  status:"complete"|"partial"|"structured_available"|"reasoning_failed";reasoning?:StructuredReasoningV1;text?:ReasoningTextV1;
  modern:DivinationModernInterpretation|null;diagnostic?:ReasoningDiagnostic;checkpoint_key:string;diagnostic_run_id?:string;
}
export function reasoningStageVersions(){const profile=reasoningProfile();return {pipeline:REASONING_STAGE_VERSION,mode:profile.mode,schema:STRUCTURED_REASONING_VERSION,reasoning_prompt:profile.prompt_version,writing_prompt:WRITING_PROMPT_VERSION,
  input:REASONING_INPUT_VERSION,explainer:EXPLAINER_VERSION,full_validator:FULL_REASONING_VERSION,max_output_tokens:profile.max_tokens,fact_guard:FACT_CLAIM_GUARD_VERSION,prompts_hash:analysisHash([profile.prompt,WRITING_PROMPT]),model_profile:analysisModelProfile()};}
export function reasoningCheckpointKey(c:ReasoningContext){return analysisHash({versions:reasoningStageVersions(),validation_mode:c.validation_mode??(reasoningMode()==="full"?"integrity":"strict"),planner:c.planner.versions,question:c.question,research_question_zh:c.research_question_zh??null,chart_hash:c.planner.chart_hash,
  confirmation_id:c.planner.confirmation_id,question_hash:c.planner.question_hash,plan_hash:c.planner.initial_plan.plan_hash,evidence:c.agent.snapshot,supplemental:c.agent.supplemental_tasks,identity:c.identity});}
interface StageDependencies {store:ReasoningStageStore;synthesize:typeof synthesizeStructuredReasoning;write:typeof writeReasoningText;assertFresh:()=>Promise<void>}
const code=(error:unknown)=>error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:"REASONING_STAGE_ERROR";
export async function runReasoningStage(owner:string,c:ReasoningContext,assertFresh:()=>Promise<void>,overrides?:Partial<StageDependencies>):Promise<ReasoningStageResult>{
  c={...c,validation_mode:c.validation_mode??(reasoningMode()==="full"?"integrity":"strict")};
  return traceNode("reasoning-stage",{validation_mode:c.validation_mode,planner:c.planner,agent:c.agent,question:c.question,identity:c.identity},()=>runReasoningStageImpl(owner,c,assertFresh,overrides));
}
async function runReasoningStageImpl(owner:string,c:ReasoningContext,assertFresh:()=>Promise<void>,overrides?:Partial<StageDependencies>):Promise<ReasoningStageResult>{
  const key=reasoningCheckpointKey(c),deps={store:reasoningStageStore(owner,key),synthesize:synthesizeStructuredReasoning,write:writeReasoningText,assertFresh,...overrides};
  let reasoning:StructuredReasoningV1|undefined;
  let callDiagnostic:{diagnostic_run_id?:string;failure_kind?:string}={};
  const failed=async(stage:ReasoningDiagnostic["stage"],message:string,attempts=0):Promise<ReasoningStageResult>=>{
    const diagnostic={stage,code:message,attempts,...callDiagnostic};try{await deps.store.save("diagnostic",diagnostic);}catch{/* Already validated evidence remains available on persistence failure. */}
    const invalidated=stage==="identity"&&/IDENTITY|CONTEXT|PROVENANCE|FROZEN|USE_ROLE/.test(message);
    return {status:reasoning&&!invalidated?"structured_available":"reasoning_failed",reasoning:invalidated?undefined:reasoning,modern:null,diagnostic,checkpoint_key:key,diagnostic_run_id:callDiagnostic.diagnostic_run_id};
  };
  try{validateReasoningContext(c);await deps.assertFresh();}catch(error){return failed("identity",code(error));}
  try{
    const cached=await deps.store.load("reasoning");
    if(cached)reasoning=await traceNode("reasoning-cache-hit",{checkpoint_key:key},()=>validateStructuredReasoning(cached,c));
    else{
      const generated=await deps.synthesize(c);
      callDiagnostic={diagnostic_run_id:generated.diagnostic_run_id,failure_kind:generated.failure_kind};
      if(generated.status==="partial"&&generated.value){
        if(c.validation_mode==="integrity")return failed("reasoning",generated.code??"REASONING_INCOMPLETE_OUTPUT",generated.attempts);
        let partial=validatePartialStructuredReasoning(generated.value,c);
        let safeReport:ReturnType<typeof conservativeExplainer>,presentation_code:string|undefined;
        try{safeReport=conservativeExplainer(partial,c);}catch(error){presentation_code=code(error);}
        if(safeReport)partial=validatePartialStructuredReasoning({...partial,explainer:safeReport},c);
        await deps.assertFresh();
        const text=reasoningTextTemplate(partial),modern=renderReasoningText(text,partial);
        if(!safeReport)modern.overall_interpretation=modern.overall_interpretation.replace("断语\n\n","断语\n\n部分分析：仅呈现已通过验证的内容，不提供最终预测。\n\n");
        const diagnostic={stage:"reasoning" as const,code:generated.code??"REASONING_PARTIAL",attempts:generated.attempts,diagnostic_run_id:generated.diagnostic_run_id,failure_kind:generated.failure_kind,...(presentation_code?{presentation_code}:{})};
        await deps.store.save("diagnostic",diagnostic);
        return {status:"partial",reasoning:partial,text,modern,diagnostic,checkpoint_key:key};
      }
      if(generated.status!=="ready"||!generated.value)return failed("reasoning",generated.code??"REASONING_FAILED",generated.attempts);
      reasoning=validateStructuredReasoning(generated.value,c);await deps.store.save("reasoning",reasoning);
    }
  }catch(error){return failed("reasoning",code(error));}
  try{
    await deps.assertFresh();
  }catch(error){return failed("identity",code(error));}
  try{
    const cached=await deps.store.load("writing");let text:ReasoningTextV1;
    if(cached)text=await traceNode("writing-cache-hit",{checkpoint_key:key},()=>validateReasoningText(cached,reasoning!));
    else if(!c.agent.snapshot.evidence.length){text=reasoningTextTemplate(reasoning);await deps.store.save("writing",text);}
    else{
      const generated=await deps.write(reasoning);
      if(generated.status!=="ready"||!generated.value)return failed("writing",generated.code??"WRITING_FAILED",generated.attempts);
      text=validateReasoningText(generated.value,reasoning);await deps.store.save("writing",text);
    }
    await deps.assertFresh();
    return {status:"complete",reasoning,text,modern:renderReasoningText(text,reasoning),checkpoint_key:key,diagnostic_run_id:callDiagnostic.diagnostic_run_id};
  }catch(error){return failed(code(error)==="REASONING_IDENTITY_CHANGED"?"identity":"writing",code(error));}
}
