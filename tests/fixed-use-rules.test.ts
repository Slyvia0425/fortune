import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import type { LiuyaoCoreFacts } from "../lib/contracts/divination";
import { validateUseRoles,buildUseRetrievalQueries } from "../lib/divination/fixed-use-rules";

const fixture=JSON.parse(readFileSync(new URL("./fixtures/liuyao-core-gou.json",import.meta.url),"utf8"));
const core=(fixture.core_facts??fixture) as LiuyaoCoreFacts;
const entry=(role:string,rule_id:string)=>({role,rule_id,meaning:"目标人物",reason:"按明确关系取用"});
const payload=(primary:unknown)=>JSON.stringify({primary,auxiliary:[],missing_information:[],uncertainties:[]});
it.each([["wealth","marriage-woman"],["officials","marriage-man"],["self","self"],["parents","parents"],["siblings","siblings"],["offspring","offspring"]])("分支%s按core定位而不接受模型爻位",(role,rule)=>{
  const result=validateUseRoles(payload(entry(role,rule)),core,"hash");
  const expected=core.main_lines.filter(l=>role==="self"?l.position_role==="self":l.kin===role).map(l=>l.ref);
  expect(result.primary?.main_line_refs).toEqual(expected);
  expect(result.status).toBe("generated");
});
it("婚姻规则不能以辅助世应代替主用神",()=>{
  expect(()=>validateUseRoles(payload(entry("officials","marriage-woman")),core,"hash")).toThrow();
  expect(()=>validateUseRoles(payload(entry("self","marriage-woman")),core,"hash")).toThrow();
});
it("关键关系未明确不生成查询",()=>{
  const result=validateUseRoles(JSON.stringify({primary:null,auxiliary:[],missing_information:["问的是谁的婚姻"],uncertainties:[]}),core,"hash");
  expect(buildUseRetrievalQueries("能否结婚",core,result)).toEqual([]);
});
it("多个查询携带取用结果和已有盘面事实",()=>{
  const result=validateUseRoles(payload(entry("officials","career")),core,"hash");
  const queries=buildUseRetrievalQueries("我能否得到职位",core,result);
  expect(queries.length).toBeGreaterThanOrEqual(2);
  expect(queries.length).toBeLessThanOrEqual(8);
  expect(queries.join(" ")).toContain("官鬼");
});
