import history from "./p1-v31-history.json";
import { validateUseRoles } from "../../lib/divination/fixed-use-rules";
import { extractAnalysisFacts } from "../../lib/divination/analysis-facts";
import { validateQuestionAnalysis } from "../../lib/divination/question-analysis";
import { emptyQuestionContext } from "../../lib/divination/core";
import type { LiuyaoCoreFacts } from "../../lib/contracts/divination";

// Explicit synthetic event labels on an EXISTING frozen Core. These are structural
// regressions, NOT ten newly cast or user-confirmed real-world frozen questions.
export const scenarioProvenance="synthetic_event_labels_existing_frozen_core_no_recast";
export const p1Scenarios=[
  {id:"debt",question:"我借出去的钱能否收回",domain:"finance",event:"debt_repayment",role:"wealth",rule:"wealth"},
  {id:"investment",question:"我这次投资能否获得收益",domain:"finance",event:"investment_return",role:"wealth",rule:"wealth"},
  {id:"exam",question:"我这次考试能否通过",domain:"education",event:"exam_result",role:"officials",rule:"exam"},
  {id:"admission",question:"我申请的学校能否录取我",domain:"education",event:"admission",role:"officials",rule:"exam"},
  {id:"promotion",question:"我这次能否获得晋升",domain:"career",event:"promotion",role:"officials",rule:"career"},
  {id:"job_change",question:"我这次能否调任成功",domain:"career",event:"job_change",role:"officials",rule:"career"},
  {id:"litigation",question:"我这次诉讼能否胜诉",domain:"legal",event:"litigation",role:"officials",rule:"litigation"},
  {id:"recovery",question:"我的身体能否康复",domain:"health",event:"recovery",role:"self",rule:"self"},
  {id:"travel",question:"我这次出行能否顺利",domain:"travel",event:"other",role:"self",rule:"self"},
  {id:"contract",question:"我这次合同签约能否完成",domain:"business",event:"contract_performance",role:"response",rule:"response"},
  {id:"parent",question:"我父亲的身体能否康复",domain:"family",event:"family_member_state",role:"parents",rule:"parents"},
] as const;
export function makeP1Scenario(scenario:typeof p1Scenarios[number]){
  const core=structuredClone(history.core) as LiuyaoCoreFacts,context=emptyQuestionContext(scenario.question);
  const question=validateQuestionAnalysis({...history.input.question_analysis,normalized_question:scenario.question,raw_event_description:scenario.question,domain:scenario.domain,event_type:scenario.event,
    time_constraint:null,target_state:null,target_state_evidence:null},context);
  const entry={role:scenario.role,rule_id:scenario.rule,meaning:"合成回归样本的固定观察角色",reason:"使用既有固定分支；非实际用户确认案例"};
  const auxiliary=scenario.role==="self"||scenario.rule==="parents"?[]:[{role:"self",rule_id:scenario.rule,meaning:"本人",reason:"合成回归样本辅助角色"}];
  const roles=validateUseRoles(JSON.stringify({primary:entry,auxiliary,missing_information:[],uncertainties:[]}),core,history.chart_hash);
  return {core,question,roles,facts:extractAnalysisFacts(core,roles,history.chart_hash)};
}
