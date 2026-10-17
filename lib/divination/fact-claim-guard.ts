import type { FactCatalog } from "./analysis-facts";
export const FACT_CLAIM_GUARD_VERSION="fact-claim-guard-negated-support-v2";

/** Reject explicit directed claims which contradict the program's frozen relations.
 * This is a conservative grammar guard, not an LLM-based semantic verifier. The
 * canonical observation is always rendered by the program, never paraphrased. */
export function assertFactClaimDirections(text:string,catalog:FactCatalog):void {
  const aliases=new Map<string,Set<string>>();
  const add=(name:string,ref:string)=>{const refs=aliases.get(name)??new Set<string>();refs.add(ref);aliases.set(name,refs);};
  const names:Record<string,string[]>={self:["世爻","世"],response:["应爻"],officials:["官鬼","官爻","官"],wealth:["妻财","财爻"],parents:["父母爻"],siblings:["兄弟爻"],offspring:["子孙爻"]};
  const primary=catalog.facts.find(f=>f.type==="role_binding"&&(f.value as {priority?:string})?.priority==="primary");
  const primaryRole=(primary?.value as {role?:string})?.role;
  const roleWords:Record<string,string>={官鬼:"officials",妻财:"wealth",父母:"parents",兄弟:"siblings",子孙:"offspring",世爻:"self",应爻:"response"};
  for(const match of text.matchAll(/(?:用神(?:改取|改用|应取|取|为|是|仍为)\s*(官鬼|妻财|父母|兄弟|子孙|世爻|应爻)|以\s*(官鬼|妻财|父母|兄弟|子孙|世爻|应爻)\s*为用神)/g)){
    if(primaryRole&&roleWords[match[1]??match[2]]!==primaryRole)throw new Error("REASONING_USE_ROLE_CHANGED");
  }
  for(const f of catalog.facts){
    for(const ref of [f.subject_ref,f.object_ref].filter((r):r is string=>!!r)){
      add(ref,ref);const match=/^(main|transformed|hidden):([1-6])$/.exec(ref);
      if(match)add(`${match[1]==="main"?"本卦第":match[1]==="transformed"?"变卦第":"第"}${match[2]}爻`,ref);
    }
    if(f.type==="role_binding"&&f.value&&typeof f.value==="object"){
      const v=f.value as {role:string;priority:string};for(const name of names[v.role]??[])add(name,f.subject_ref);
      if(v.priority==="primary")add("用神",f.subject_ref);
    }
  }
  if(!aliases.size)return;
  const escape=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const token=[...aliases.keys()].sort((a,b)=>b.length-a.length).map(escape).join("|");
  const pattern=new RegExp(`(${token})\\s*(?:之|五行|土|金|木|水|火|为|直接|来|去|能|会|所|所能|对)?\\s*(生助|生扶|生向|生|克制|克向|克|受其所生|受其所克)\\s*(${token})`,"g");
  for(const match of text.matchAll(pattern)){
    const offset=match.index??0,prefix=text.slice(0,offset),start=Math.max(prefix.lastIndexOf("。"),prefix.lastIndexOf("；"),prefix.lastIndexOf("\n"))+1;
    const introduction=prefix.slice(start);
    // A source's general rule or an explicit hypothetical is not a statement
    // that its direction holds in the current frozen chart.
    if((/原文|古籍|理论|规则|文献/.test(introduction)||/(?:若|如果|假设)[^，。；]*$/.test(introduction))&&!/当前|本卦|本盘|盘面|此卦|实际关系/.test(introduction))continue;
    const sources=aliases.get(match[1])!,targets=aliases.get(match[3])!;
    if(sources.size!==1||targets.size!==1)throw new Error("REASONING_RELATION_AMBIGUOUS");
    const a=[...sources][0],b=[...targets][0];
    const expected=match[2].startsWith("受")?(match[2].endsWith("生")?"generated_by":"controlled_by"):match[2].startsWith("生")?"generates":"controls";
    const relation=catalog.facts.find(f=>f.type==="line_relationship"&&f.subject_ref===a&&f.object_ref===b);
    if(!relation||(relation.value as {element_relation?:string})?.element_relation!==expected)throw new Error("REASONING_RELATION_DIRECTION_INVALID");
  }
}

/** PR6.5 does not derive advance/retreat. A definition query is not a chart fact.
 * Conservative surface guard, not a claim of complete natural-language verification. */
export function assertNoUnverifiedDerivation(text:string):void {
  for(const original of text.split(/[，。；！？\n]/)){
    // Remove only an explicitly negated support proposition. Do not exempt the
    // whole clause: a subsequent “但用神已经化退” must still be checked.
    const clause=original.replace(/缺乏[^，。；！？]{0,12}(?:依据|证据|规则)(?:支持|证明|确认)(?:(?!但|然而|不过|却|实际|事实上)[^，。；！？]){0,32}?(?:化退|化进)(?:或(?:化退|化进))?/g,"");
    // A quoted general rule (e.g. 喜宜化进，忌宜化退) is not a claim about
    // this chart. Require a concrete subject or explicit established verdict.
    const assertion=/(?:(?:当前|本卦|此卦|本盘|官鬼|用神|世爻|应爻|第[一二三四五六1-6]爻|[一二三四五六]爻|[子丑寅卯辰巳午未申酉戌亥][金木水火土]?[变化][子丑寅卯辰巳午未申酉戌亥][金木水火土]?)[^。；！？]{0,24}(?:化退|化进|(?:属于|构成|为|是|即为)(?:进神|退神))|(?:已|已经|确定|确已)(?:化退|化进|构成退神|构成进神)|(?:退神|进神)(?:已经|已|确已)成立)/.test(clause);
    if(assertion&&!/(?:若|如果|是否|可能|或许|未必|不一定|有待|尚待|尚未|未能|不能|不可|不足|不代表|待核|待确认|需确认|需核验|需核查|需查证|定义|假设|未定|未确认|未判定)/.test(clause))throw new Error("REASONING_FACT_CLAIM_INVALID");
  }
}
