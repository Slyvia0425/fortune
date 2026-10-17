import type { LiuyaoCoreFacts, UseRoleAnalysis } from "../contracts/divination";
import { validateUseRoles } from "./fixed-use-rules";
import { analysisHash, canonicalAnalysis, freezeAnalysis } from "./analysis-utils";
import { deriveCoreRelations, selectCoreRelations, RELATION_ENGINE_VERSION } from "./fact-relations";

export const FACT_CATALOG_VERSION = "analysis-facts-v1";
export const FACT_DERIVATION_VERSION = RELATION_ENGINE_VERSION;
export type FactType = "role_binding"|"moving"|"transformation"|"month_break"|"day_clash"|"xun_empty"|"month_seasonal_label"|"hidden_location"|"line_relationship";
export interface AnalysisFact {
  fact_id:string; type:FactType; subject_ref:string; object_ref?:string; value:unknown;
  source:"frozen_core"|"derived_verified"; derivation_version?:string;
}
export interface FactCatalog { version:typeof FACT_CATALOG_VERSION; chart_hash:string; roles_version:string; facts:AnalysisFact[] }

export function verifiedRoles(core:LiuyaoCoreFacts,roles:UseRoleAnalysis,chartHash:string):UseRoleAnalysis {
  if(roles.status!=="generated"||!roles.primary||roles.chart_hash!==chartHash)throw new Error("ANALYSIS_ROLES_UNRESOLVED");
  if(roles.primary.rule_id==="career"&&!roles.auxiliary.some(r=>r.role==="self"))throw new Error("ANALYSIS_CAREER_SELF_REQUIRED");
  const encode=(r:NonNullable<UseRoleAnalysis["primary"]>)=>({role:r.role,meaning:r.meaning,rule_id:r.rule_id,reason:r.reason});
  const verified=validateUseRoles(JSON.stringify({primary:encode(roles.primary),auxiliary:roles.auxiliary.map(encode),missing_information:roles.missing_information,uncertainties:[]}),core,chartHash);
  for(const [i,original] of [roles.primary,...roles.auxiliary].entries()){
    const actual=[verified.primary!,...verified.auxiliary][i];
    if(canonicalAnalysis([original.main_line_refs,original.hidden_line_refs,original.location_status])!==canonicalAnalysis([actual.main_line_refs,actual.hidden_line_refs,actual.location_status]))throw new Error("ANALYSIS_ROLE_REFS_INVALID");
  }
  if(verified.primary?.location_status==="absent"||verified.primary?.location_status==="unknown")throw new Error("ANALYSIS_PRIMARY_NOT_LOCATED");
  return {...verified,rules_version:roles.rules_version};
}

export function extractAnalysisFacts(core:LiuyaoCoreFacts,roles:UseRoleAnalysis,chartHash:string):FactCatalog {
  verifiedRoles(core,roles,chartHash);
  if(!core.main_lines_complete||core.main_lines.length!==6)throw new Error("ANALYSIS_CORE_INCOMPLETE");
  const lines=[...core.main_lines,...core.hidden_lines,...core.transformed_lines];
  if(new Set(lines.map(l=>l.ref)).size!==lines.length)throw new Error("ANALYSIS_CORE_DUPLICATE_REF");
  const facts:AnalysisFact[]=[];
  const add=(type:FactType,subject_ref:string,value:unknown,source:AnalysisFact["source"]="frozen_core",object_ref?:string)=>{
    if(!lines.some(l=>l.ref===subject_ref)||(object_ref&&!lines.some(l=>l.ref===object_ref)))throw new Error("ANALYSIS_FACT_REF_INVALID");
    facts.push({fact_id:"fact_"+analysisHash([chartHash,subject_ref,object_ref??null,type,value,FACT_DERIVATION_VERSION]).slice(0,24),type,subject_ref,
      ...(object_ref?{object_ref}:{}),value,source,...(source==="derived_verified"?{derivation_version:FACT_DERIVATION_VERSION}:{})});
  };
  for(const [i,role] of [roles.primary!,...roles.auxiliary].entries()){
    for(const ref of [...role.main_line_refs,...role.hidden_line_refs])add("role_binding",ref,{role:role.role,priority:i===0?"primary":"auxiliary",rule_id:role.rule_id},"derived_verified");
  }
  for(const line of [...core.main_lines,...core.hidden_lines]){
    add("moving",line.ref,typeof line.moving==="boolean"?line.moving:null);
    for(const key of ["month_break","day_clash","xun_empty"] as const)add(key,line.ref,typeof line.strength?.[key]==="boolean"?line.strength[key]:null);
    add("month_seasonal_label",line.ref,line.strength?.month_seasonal_label??null);
    if(line.ref.startsWith("hidden:"))add("hidden_location",line.ref,{flying_line_ref:line.flying_line_ref??null,usability_status:line.usability_status??"unknown"});
    if(line.moving){
      const changed=core.transformed_lines.filter(l=>l.position===line.position);
      if(changed.length>1)throw new Error("ANALYSIS_TRANSFORMATION_AMBIGUOUS");
      if(changed[0])add("transformation",line.ref,{from_branch:line.branch,to_branch:changed[0].branch,from_element:line.element,to_element:changed[0].element,changed_kin:changed[0].kin},"frozen_core",changed[0].ref);
      else add("transformation",line.ref,null);
    }
  }
  // Compute only element direction from known elements; never derive strength,
  // advance/retreat, usability, or a fortunate/unfortunate outcome here.
  const refs=[...new Set([roles.primary!,...roles.auxiliary].flatMap(r=>[...r.main_line_refs,...r.hidden_line_refs]))];
  for(const relation of selectCoreRelations(deriveCoreRelations(core,chartHash),refs)){
    const {source_ref,target_ref,...value}=relation;
    add("line_relationship",source_ref,value,"derived_verified",target_ref);
  }
  return freezeAnalysis({version:FACT_CATALOG_VERSION,chart_hash:chartHash,roles_version:roles.rules_version,facts});
}
