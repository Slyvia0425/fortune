import { readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { beforeAll, describe, expect, it } from "vitest";
import { emptyQuestionContext } from "../lib/divination/core";
import { validateUseRoles } from "../lib/divination/fixed-use-rules";
import { extractAnalysisFacts } from "../lib/divination/analysis-facts";
import type { LiuyaoCoreFacts } from "../lib/contracts/divination";
import type { SingleQuestionAnalysis } from "../lib/divination/question-analysis";

// Synthetic questions and an existing frozen-core fixture; no new casts or
// writes to the runtime/corpus. Opt in explicitly when checking a configured model.
describe.skipIf(process.env.FORTUNE_LIVE_PLANNER!=="1")("PR-3 configured model smoke",()=>{
  let q1:typeof import("../lib/server/analysis-planner-llm").analyzeSingleQuestion;
  let p1:typeof import("../lib/server/analysis-planner-llm").planAnalysisTasks;
  let job:SingleQuestionAnalysis;
  let transport:typeof import("../lib/server/divination-llm").requestPlannerJson;
  beforeAll(async()=>{
    loadEnvFile(".env.local");
    const service=await import("../lib/server/analysis-planner-llm");q1=service.analyzeSingleQuestion;p1=service.planAnalysisTasks;
    transport=(await import("../lib/server/divination-llm")).requestPlannerJson;
  });
  it.each([
    ["未来三个月能找到新工作吗","career","new_job","outcome","valid"],
    ["今年能与现在伴侣结婚吗","relationship","marriage","outcome","valid"],
    ["借出去的钱能按约定收回吗","finance","debt_repayment","outcome","valid"],
    ["能复合吗，复合以后什么时候结婚","relationship","reconciliation","outcome","semantic_conflict"],
  ])("%s",async(raw,domain,event,type,status)=>{
    const context={...emptyQuestionContext(raw),parser_status:"parsed" as const,goal_groups:[raw],goal:{value:raw,provenance:"user_explicit" as const,verification_status:"extracted" as const}};
    const result=await q1(context,async(system,input,repair)=>{
      const response=await transport(system,input,repair);
      if(process.env.FORTUNE_LIVE_DEBUG==="1")console.info("synthetic Q1 output",response);
      return response;
    });
    expect(result.status,result.issues.join(",")).toBe(status);expect(result.normalized_question).toBe(raw);
    if(status==="valid"){expect(result.domain).toBe(domain);expect(result.event_type).toBe(event);expect(result.question_type).toBe(type);expect(result.current_state).toBeNull();}
    if(event==="new_job")job=result;
  },130_000);
  it("配置模型可生成合法求职初始计划",async()=>{
    expect(job?.status).toBe("valid");
    const core=JSON.parse(readFileSync(new URL("../docs/examples/liuyao-245-core.json",import.meta.url),"utf8")) as LiuyaoCoreFacts;
    const roles=validateUseRoles(JSON.stringify({primary:{role:"officials",rule_id:"career",meaning:"职位",reason:"现代求职受控类比"},auxiliary:[{role:"self",rule_id:"career",meaning:"本人",reason:"固定事业分支要求观察世爻"}],missing_information:[],uncertainties:[]}),core,"existing-fixture-hash");
    const facts=extractAnalysisFacts(core,roles,"existing-fixture-hash");
    const plan=await p1(job,roles,facts,"synthetic-question-hash");
    expect(plan.status,plan.warnings.join(",")).toBe("generated");expect(plan.tasks.length).toBeLessThanOrEqual(7);
  },130_000);
});
