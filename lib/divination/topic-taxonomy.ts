export const QUESTION_TAXONOMY_VERSION = "single-question-taxonomy-v1";
export const TOPIC_TAXONOMY_VERSION = "analysis-topics-v1";
export const QUESTION_TYPES = ["outcome", "timing", "current_state", "intention", "decision", "comparison", "development", "reason", "unknown"] as const;
export type QuestionType = typeof QUESTION_TYPES[number];
export const EVENT_TAXONOMY = {
  relationship: ["relationship_formation", "reconciliation", "marriage", "separation", "partner_feelings", "relationship_development", "other"],
  career: ["new_job", "interview_result", "promotion", "job_change", "job_offer_decision", "hiring_other", "other"],
  finance: ["investment_return", "income_change", "debt_repayment", "financial_decision", "asset_transaction", "other"],
  health: ["recovery", "health_state", "symptom", "other"],
  education: ["admission", "exam_result", "study_decision", "other"],
  business: ["partnership", "contract_performance", "business_return", "other"],
  family: ["family_member_state", "other"], property: ["property_sale", "property_purchase", "other"],
  travel: ["travel_outcome", "other"], legal: ["litigation", "other"], other: ["other"],
} as const;
export type QuestionDomain = keyof typeof EVENT_TAXONOMY;

export const TOPICS = {
  use_role: { label:"取用角色", terms:["用神", "取用"] },
  self_response: { label:"世应关系", terms:["世爻", "应爻", "世应"] },
  moving_line: { label:"动静", terms:["动爻", "静爻", "发动"] },
  transformation: { label:"动变", terms:["动变", "变爻"] },
  advance_retreat: { label:"进退神定义", terms:["进退神", "进神", "退神"] },
  month_break: { label:"月破", terms:["月破", "月建"] },
  day_month: { label:"日月作用", terms:["日辰", "月建"] },
  xun_empty: { label:"旬空", terms:["旬空", "空亡"] },
  day_clash: { label:"日冲", terms:["日冲", "日辰"] },
  hidden_spirit: { label:"伏神条件", terms:["伏神", "飞神"] },
  generation_restriction: { label:"生克关系", terms:["生克", "生扶", "克制"] },
  timing: { label:"应期前提", terms:["应期", "应期条件"] },
  officials: { label:"官鬼", terms:["官鬼"] }, wealth: { label:"妻财", terms:["妻财"] },
  parents: { label:"父母", terms:["父母"] }, siblings: { label:"兄弟", terms:["兄弟"] }, offspring: { label:"子孙", terms:["子孙"] },
} as const;
export type TopicId = keyof typeof TOPICS;
export const TASK_KINDS = ["role_condition", "moving_transformation", "month_day_effect", "line_relationship", "hidden_condition", "timing"] as const;
export type TaskKind = typeof TASK_KINDS[number];
export const KIND_TOPICS: Record<TaskKind, readonly TopicId[]> = {
  role_condition:["use_role", "self_response", "officials", "wealth", "parents", "siblings", "offspring"],
  moving_transformation:["moving_line", "transformation", "advance_retreat"],
  month_day_effect:["month_break", "day_month", "xun_empty", "day_clash"],
  line_relationship:["self_response", "generation_restriction"], hidden_condition:["hidden_spirit"], timing:["timing"],
};

// These are compatibility boundaries for the EXISTING fixed registry, not new
// traditional rules or a statement that an event's outcome can be predicted.
export function allowedPrimaryRuleIds(domain:QuestionDomain,event:string):readonly string[] | null {
  if(domain==="career")return event==="hiring_other"?["response"]:event==="job_offer_decision"?["response", "career"]:["career"];
  if(domain==="relationship")return event==="marriage"?["marriage-woman", "marriage-man"]:
    event==="reconciliation"||event==="relationship_formation"?["response", "marriage-woman", "marriage-man"]:["response"];
  if(domain==="finance")return ["wealth"];
  if(domain==="education")return ["exam", "parents", "response"];
  if(domain==="legal"&&event==="litigation")return ["litigation"];
  return null; // Unknown domains remain other/description; let the fixed resolver decide.
}
