import { describe,expect,it } from "vitest";
import { fallbackRetrievalPlan,parseRetrievalPlan,retrievalFacts } from "../lib/divination/retrieval-plan";
import { validateUseRoles } from "../lib/divination/fixed-use-rules";
import type { LiuyaoCoreFacts } from "../lib/contracts/divination";

// Minimal synthetic fixture; no runtime files or paid model calls.
const core={calendar:{month_branch:"戌",day_branch:"申"},main_lines:[
  {ref:"main:5",position:5,branch:"酉",element:"金",kin:"officials",kin_name:"官鬼",moving:true,strength:{month_seasonal_label:"相"}},
  {ref:"main:3",position:3,branch:"辰",element:"土",kin:"wealth",kin_name:"妻财",position_role:"self",moving:false,strength:{month_break:true,month_seasonal_label:"旺"}},
],hidden_lines:[],transformed_lines:[{position:5,branch:"申",element:"金",kin_name:"官鬼"}],main_lines_complete:true,hidden_lines_complete:true} as unknown as LiuyaoCoreFacts;
const roles=validateUseRoles(JSON.stringify({primary:{role:"officials",meaning:"职位",rule_id:"career",reason:"求职"},auxiliary:[{role:"self",meaning:"自己",rule_id:"career",reason:"自己"}],missing_information:[],uncertainties:[]}),core,"hash");
const draft={queries:[{lane:"theory",fact_ids:["main:5"],search_terms:["进退神","动变"]},{lane:"case",fact_ids:["main:3"],search_terms:["求官","功名","占例"]}]};
describe("LLM检索规划",()=>{
  it("保留原始query并从core补全酉化申与月破",()=>{
    const plan=parseRetrievalPlan(JSON.stringify(draft),"三个月找工作",core,roles);
    expect(plan.status).toBe("generated");
    expect(plan.queries.length).toBeLessThanOrEqual(8);
    expect(plan.queries.filter(q=>q.lane==="all").map(q=>q.query)).toEqual(plan.baseline_queries);
    expect(plan.queries.find(q=>q.lane==="theory")?.query).toContain("酉化申");
    expect(plan.queries.find(q=>q.lane==="case")?.query).toContain("月破");
    expect(retrievalFacts(core,roles)[0].text).toContain("月令相");
  });
  it("拒绝伪造事实、现实引申和额外自由query",()=>{
    for(const item of [{...draft.queries[0],fact_ids:["main:6"]},{...draft.queries[0],search_terms:["准备不足"]},{...draft.queries[0],query:"官鬼衰"}])
      expect(()=>parseRetrievalPlan(JSON.stringify({queries:[item,draft.queries[1]]}),"找工作",core,roles)).toThrow();
  });
  it("缺少分路或超量输出拒绝，回退保持原始query",()=>{
    expect(()=>parseRetrievalPlan(JSON.stringify({queries:[draft.queries[0],draft.queries[0]]}),"找工作",core,roles)).toThrow("LANES");
    expect(()=>parseRetrievalPlan(JSON.stringify({queries:Array(5).fill(draft.queries[0])}),"找工作",core,roles)).toThrow();
    const plan=fallbackRetrievalPlan("找工作",core,roles,"failed");
    expect(plan.status).toBe("fallback");expect(plan.queries.every(q=>q.lane==="all")).toBe(true);
  });
});
