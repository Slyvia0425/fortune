import type { FactCatalog } from "./analysis-facts";
import type { LiuyaoCoreFacts } from "../contracts/divination";
import { assertFactClaimDirections, assertNoUnverifiedDerivation } from "./fact-claim-guard";
export const PLANNER_VALIDATOR_VERSION="p1-validator-v31.2";

export interface PlannerValidationIssue {
  code:string; task_id?:string; path?:string; received?:unknown; expected?:unknown; related_fact_refs?:string[];
  coverage_id?:string; message:string;
  suggested_action?:"change_kind"|"add_coverage"|"remove_unsupported_assertion"|"replace_topic"|"replace_fact_ref"|"reduce_priority"|"manual_review";
}
export class PlannerValidationError extends Error {
  constructor(public issues:PlannerValidationIssue[]){super(issues[0]?.code??"PLAN_INVALID");this.name="PlannerValidationError";}
}
/** Conservative annotated surface checks, not an arbitrary Chinese semantic proof.
 * Research hypotheses and quoted terminology remain valid; unresolved complex prose
 * is still a manual-review risk. No wording is silently removed or rewritten. */
export function plannerPremiseIssues(text:string,path:string,task_id:string,facts:FactCatalog,core?:LiuyaoCoreFacts):PlannerValidationIssue[]{
  const issues:PlannerValidationIssue[]=[];
  const add=(code:string,message:string)=>issues.push({code,path,task_id,received:text,message,suggested_action:"remove_unsupported_assertion"});
  try{assertFactClaimDirections(text,facts);}catch(error){add(error instanceof Error?error.message:"PLAN_FACT_CLAIM_INVALID","方向或取用表述与程序事实不一致；仅引用既有方向，不重新取用。");}
  try{assertNoUnverifiedDerivation(text);}catch{add("PLAN_UNSUPPORTED_ASSUMPTION","将尚未核验的进退神分类作为当前卦的既定事实；改为核验定义、条件和例外。");}
  for(const sentence of text.split(/[。；;\n]/)){
    if(/(?:调整|改变|重新(?:选择|确定|选取)?|改选|改取)[^，,。；]{0,12}(?:用神|取用)/.test(sentence)&&!/(?:不得|不能|不应|禁止)[^，,。；]{0,8}(?:调整|改变|重新|改选|改取)/.test(sentence))add("PLAN_ROLE_RESELECTION_REQUEST","研究目标要求重新选择或调整已定用神；P1 只能研究该角色的状态、作用与适用条件。");
    const pattern=/极度(?:虚弱|衰弱)|极凶|彻底无用|已无能力(?:获得|胜任)|状态(?:极差|极为不利)|自身极弱|这将直接决定/g;
    for(const match of sentence.matchAll(pattern)){
      const prefix=sentence.slice(0,match.index),local=prefix.slice(Math.max(prefix.lastIndexOf("，"),prefix.lastIndexOf(","))+1);
      const question=/(?:是否|何为|如何(?:界定|定义|核验|区分)|能否|可否|若|如果|假设|不代表|并非|不能(?:认定|断定)|不得(?:认定|断定)|尚未(?:认定|判定))[^，,]*$/.test(local);
      const quotedTheory=/[“「『‘][^”」』’]*$/.test(prefix)&&/(?:理论|术语|定义|原文|规则|界定)/.test(prefix);
      if(!question&&!quotedTheory)add("PLAN_UNSUPPORTED_ASSUMPTION","综合旺衰或吉凶被断言为已成立前提；局部标记不能直接推出此结论。");
    }
    // A question about mitigating/amplifying X still presupposes X. Asking
    // whether to '加剧世爻的虚弱' is not asking whether weakness applies at all.
    const presupposition=/(?:加剧|缓解|克服|挽救|改善|抵抗)[^，,。；]{0,18}(?:世爻(?:本身|自身)?的?(?:虚弱|衰弱)|(?:动爻|用神|官鬼)?(?:化退|化进)|(?:退神|进神))/g;
    for(const match of sentence.matchAll(presupposition)){
      const prefix=sentence.slice(0,match.index);
      if(!/(?:若|如果|假设)[^。；]*(?:确认|核验|成立|判定|属于)/.test(prefix))add("PLAN_UNSUPPORTED_ASSUMPTION","问句以缓解、加剧或抵抗的对象预设了未核验的强弱／进退分类；应先研究该分类是否成立。");
    }
    for(const match of sentence.matchAll(/(?:由|从)(?:旺相|旺|相)(?:支|之支|状态)?变(?:为|成)?(?:休囚|衰弱|休|囚)(?:支|之支|状态)?|(?:这|两|这两)种负面状态|(?:月破|日冲)[^，,。；]{0,12}(?:属于|均为|都是|为)负面/g)){
      const prefix=sentence.slice(0,match.index);
      if(/是否|不能认定|不代表|未判定/.test(match[0]))continue;
      if(!/(?:若|如果|假设|是否|不能认定|不代表|未判定)[^，,]*$/.test(prefix)&&!/[“「『‘][^”」』’]*$/.test(prefix))add("PLAN_UNSUPPORTED_ASSUMPTION","将局部标记或动变预先分类为负面或旺相转休囚；应以程序原始标记研究分类是否成立。");
    }
    for(const match of sentence.matchAll(/(?:世爻|用神)(?:本身|自身)?的?(?:虚弱|衰弱)/g)){
      const prefix=sentence.slice(0,match.index),local=prefix.slice(Math.max(prefix.lastIndexOf("，"),prefix.lastIndexOf(","))+1);
      if(!/(?:若|如果|假设|是否(?:已|已经)?(?:处于|为|是)?|不能认定|不代表|尚未判定|何为|何谓|如何(?:界定|定义|判定)|需核验|需核查|待核验)[^，,]*$/.test(local)&&!/[“「『‘][^”」』’]*$/.test(prefix))add("PLAN_UNSUPPORTED_ASSUMPTION","将世爻或用神的综合虚弱作为既定名词前提；程序只提供局部标记。");
    }
  }
  if(core){
    const names:Record<string,string>={妻财:"wealth",官鬼:"officials",父母:"parents",兄弟:"siblings",子孙:"offspring"};
    // An explicit role/branch attached to this chart's hidden spirit is a
    // checkable Core assertion, not a theoretical classification. No new facts.
    for(const match of text.matchAll(/伏神(?:为|是|六亲为)?(?:[“‘「])?(妻财|官鬼|父母|兄弟|子孙)(?:[”’」])?/g)){
      if(!core.hidden_lines.some(line=>line.kin===names[match[1]]))add("PLAN_FACT_CLAIM_INVALID","伏神六亲表述与 frozen Core 不符；必须沿用 optional_line_context，不得自行补齐人物或六亲。");
    }
    for(const match of text.matchAll(/伏神(?:妻财|官鬼|父母|兄弟|子孙)?(?:位于|在|为|是|地支为)([子丑寅卯辰巳午未申酉戌亥])(?:[金木水火土])?(?=上|下|爻|，|。|；|之|$)/g)){
      if(!core.hidden_lines.some(line=>line.branch===match[1]))add("PLAN_FACT_CLAIM_INVALID","伏神地支表述与 frozen Core 不符；应使用 Core 已有地支，不是模型猜测。");
    }
    for(const match of text.matchAll(/(hidden:[1-6])[^，。；]{0,10}(?:六亲为|为)(妻财|官鬼|父母|兄弟|子孙)/g)){
      if(core.hidden_lines.find(line=>line.ref===match[1])?.kin!==names[match[2]])add("PLAN_FACT_CLAIM_INVALID","具体 hidden ref 的六亲不符合 Core。");
    }
  }
  // Check simple affirmative condition claims against actual frozen role facts.
  for(const match of text.matchAll(/(世爻|官鬼|用神)(?:爻)?(?:的)?(月破|日冲|旬空)(?:成立)?/g)){
    const prefix=text.slice(0,match.index),local=prefix.slice(Math.max(prefix.lastIndexOf("。"),prefix.lastIndexOf("，"),prefix.lastIndexOf("；"))+1);
    if(/是否|若|如果|假设|定义|规则|不代表|尚未/.test(local))continue;
    const binding=facts.facts.filter(f=>f.type==="role_binding"&&(match[1]==="用神"?(f.value as {priority:string}).priority==="primary":(f.value as {role:string}).role===(match[1]==="世爻"?"self":"officials")));
    const type=({月破:"month_break",日冲:"day_clash",旬空:"xun_empty"} as const)[match[2] as "月破"|"日冲"|"旬空"];
    if(binding.length&&binding.some(b=>facts.facts.find(f=>f.subject_ref===b.subject_ref&&f.type===type)?.value!==true))add("PLAN_FACT_CLAIM_INVALID","肯定式空破冲表述不符合冻结事实；不得将不存在或未知的条件说成成立。");
  }
  return issues;
}
export function normalizePlannerOutput(raw:unknown):{value:unknown;changes:string[]}{
  const changes:string[]=[];
  if(!raw||typeof raw!=="object"||!Array.isArray((raw as {tasks?:unknown}).tasks))return {value:raw,changes};
  const value={...raw,tasks:((raw as {tasks:unknown[]}).tasks).map((task,index)=>{
    if(!task||typeof task!=="object"||Array.isArray(task))return task;
    return Object.fromEntries(Object.entries(task).map(([key,value])=>{
      if(typeof value==="string"&&value!==value.trim()){changes.push(`tasks[${index}].${key}:trim`);return [key,value.trim()];}
      if(key==="topic_ids"&&Array.isArray(value)&&value.every(v=>typeof v==="string")){
        const clean=[...new Set(value.map(v=>v.trim()))];if(JSON.stringify(value)!==JSON.stringify(clean))changes.push(`tasks[${index}].topic_ids:trim_deduplicate`);return [key,clean];
      }
      return [key,value];
    }));
  })};
  return {value,changes};
}
