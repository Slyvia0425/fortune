import type { LiuyaoCoreFacts } from "../contracts/divination";
import type { AnalysisFact, FactCatalog } from "./analysis-facts";

export const ROLE_LABELS:Record<string,string>={officials:"官鬼",self:"世爻",response:"应爻",wealth:"妻财",parents:"父母",siblings:"兄弟",offspring:"子孙"};
export function plannerLineLabel(ref:string,facts:FactCatalog,core?:LiuyaoCoreFacts){
  const line=core?[...core.main_lines,...core.transformed_lines,...core.hidden_lines].find(l=>l.ref===ref):undefined;
  const binding=facts.facts.find(f=>f.subject_ref===ref&&f.type==="role_binding");
  const role=binding?ROLE_LABELS[(binding.value as {role:string}).role]:line?ROLE_LABELS[line.kin]:"";
  const transform=facts.facts.find(f=>f.type==="transformation"&&f.subject_ref===ref)?.value as {from_branch?:string;from_element?:string}|undefined;
  return `${ref.startsWith("transformed:")?"变卦":ref.startsWith("hidden:")?"伏神":"本卦"}第${ref.split(":")[1]}爻${role??""}${line?.branch??transform?.from_branch??""}${line?.element??transform?.from_element??""}`;
}
export function plannerFactDescription(f:AnalysisFact,facts:FactCatalog,core?:LiuyaoCoreFacts){
  const line=plannerLineLabel(f.subject_ref,facts,core),v=f.value as Record<string,unknown>|null;
  if(f.type==="role_binding")return `${line}为程序确定的${(v?.priority==="primary"?"主观察":"辅助")}角色`;
  if(f.type==="transformation")return `${line}发动变${v?.to_branch??"未知地支"}${v?.to_element??""}`;
  if(f.type==="line_relationship"){
    const relation:Record<string,string>={generates:"生向",generated_by:"受其所生于",controls:"克向",controlled_by:"受其所克于",same_element:"与其同五行于"};
    return `${line}（${v?.source_element??"未知五行"}）${relation[String(v?.element_relation)]??"关系未知"}${plannerLineLabel(f.object_ref??"unknown",facts,core)}（${v?.target_element??"未知五行"}）`;
  }
  if(f.type==="month_seasonal_label")return `${line}月令五行局部标签为${String(f.value??"missing")}（非综合旺衰）`;
  if(["month_break","day_clash","xun_empty"].includes(f.type))return `${line}${({month_break:"月破",day_clash:"日冲",xun_empty:"旬空"} as Record<string,string>)[f.type]}${f.value===true?"成立":f.value===false?"不成立":"未知"}`;
  if(f.type==="hidden_location")return `${line}伏于${String(v?.flying_line_ref??"未知飞爻")}，可用性为${String(v?.usability_status??"未知")}`;
  return `${line}动静标记为${String(f.value)}`;
}
