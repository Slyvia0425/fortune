import { afterEach, describe, expect, it, vi } from "vitest";
import { canCastChatReply } from "../lib/divination/chat-gate";
import { parseQuestionContext } from "../lib/server/divination-llm";
import type { DivinationChatMessage, QuestionContext } from "../lib/contracts/divination";

const candidate = (overrides: Record<string, unknown> = {}) => ({
  raw_question:"未来三个月能找到工作吗",domain:"career",question_type:"outcome",event_type:"other",
  goal:"找到工作",goal_groups:["找到工作"],target_entities:[],relationships:[],ambiguities:[],...overrides,
});

describe("D1 分类契约", () => {
  it("英文实体、关系与相对时间保留原文证据",()=>{
    const text="Will my trip to Shanghai to visit friends next month go smoothly?";
    const result=parseQuestionContext(JSON.stringify(candidate({raw_question:text,domain:"travel",goal:"trip smoothness",goal_groups:["trip smoothness"],time_expression:"next month",target_entities:[{entity_id:"e1",label:"friends",kind:"person"}],relationships:[{from_entity_id:"perspective",to_entity_id:"e1",relation:"friend",evidence_text:"friends"}]})),[{role:"user",content:text}]);
    if(!result||result.need_follow_up)throw new Error("expected context");
    expect(result.context.raw_question).toBe(text);
    expect(result.context.time_expression.value).toBe("next month");
    expect(result.context.relationships[0]).toMatchObject({to_entity_id:"entity-1",evidence:{text:"friends"}});
  });
  it.each([ ["career","outcome","feasibility"], ["relationship","timing","timing"],
    ["finance","current_state","status"], ["business","intention","status"] ])("区分 %s 领域与 %s 功能", (domain,type,legacy) => {
    const result=parseQuestionContext(JSON.stringify(candidate({domain,question_type:type})),[]);
    expect(result?.need_follow_up).toBe(false);
    if(result&&!result.need_follow_up){expect(result.context.domain).toBe(domain);expect(result.context.question_type).toBe(type);expect(result.context.question_kind.value).toBe(legacy);}
  });
  it("遗漏独立占事列表或沿用中文分类时拒绝",()=>{
    expect(parseQuestionContext(JSON.stringify(candidate({goal_groups:undefined})),[])).toBeNull();
    expect(parseQuestionContext(JSON.stringify(candidate({question_type:"事业"})),[])).toBeNull();
  });
  it("Unicode 引用按 UTF-16 切片一致",()=>{
    const messages:DivinationChatMessage[]=[{role:"user",content:"🙂我想问😀工作"}];
    const result=parseQuestionContext(JSON.stringify(candidate({goal:"😀工作"})),messages);
    if(!result||result.need_follow_up)throw new Error("expected context");
    const evidence=result.context.goal.evidence!;
    expect(messages[0].content.slice(evidence.start_offset,evidence.end_offset_exclusive)).toBe(evidence.text);
  });
  it("关系引用随实体 ID 正确映射，并保留用户原文",()=>{
    const result=parseQuestionContext(JSON.stringify(candidate({target_entities:[{entity_id:"e1",label:"我",kind:"person"},{entity_id:"e2",label:"前男友",kind:"person"}],relationships:[{from_entity_id:"e1",to_entity_id:"e2",relation:"former_partner",evidence_text:"前男友"}]})),[{role:"user",content:"我和前男友能复合吗"}]);
    if(!result||result.need_follow_up)throw new Error("expected context");
    expect(result.context.relationships[0]).toMatchObject({from_entity_id:"entity-1",to_entity_id:"entity-2",evidence:{text:"前男友"}});
    expect(()=>parseQuestionContext(JSON.stringify(candidate({relationships:[{from_entity_id:"missing",to_entity_id:"bad",relation:"前男友"}]})),[])).toThrow("QUESTION_RELATION_INVALID");
  });
});

describe("前置起卦 gate",()=>{
  afterEach(()=>vi.restoreAllMocks());
  async function reply(overrides:Record<string,unknown>={},text="未来三个月能找到工作吗 3、6、8"){
    const llm=await import("../lib/server/divination-llm");
    vi.spyOn(llm,"extractQuestionContext").mockResolvedValue(parseQuestionContext(JSON.stringify(candidate(overrides)),[]));
    const {continueDivinationChatWithLlm}=await import("../lib/divination/chat");
    return continueDivinationChatWithLlm([{role:"user",content:text}]);
  }
  it("明确单一占事只进入待确认，不能自动起卦",async()=>{
    const result=await reply();expect(result.status).toBe("ready_for_confirmation");expect(result.cast_request).toBeUndefined();expect(canCastChatReply(result)).toBe(false);
  });
  it("数字时间不是起卦数字，独立三数仍可确认",async()=>{
    const result=await reply({},"未来3个月能找到工作吗，数字18、27、9");
    expect(result.extraction?.numbers).toEqual([18,27,9]);expect(result.status).toBe("ready_for_confirmation");
  });
  it.each(["数字3、6、8、9", "数字3、6", "数字0、6、8"])("要求恰好三个正整数：%s",async(text)=>{
    const result=await reply({},`能找到工作吗，${text}`);
    expect(result.status).toBe("clarify");expect(result.extraction?.numbers).toBeUndefined();
  });
  it("模型返回多目标时无 cast_request",async()=>{
    const result=await reply({goal_groups:["复合","结婚"]});
    expect(result.status).toBe("clarify");expect(result.cast_request).toBeUndefined();expect(canCastChatReply(result)).toBe(false);
  });
  it.each(["能复合吗？何时结婚？3、6、8","可以复合并结婚吗 3、6、8","能拿到offer吗，薪水约是多少 3、6、8"])("阻止模型静默压缩多问：%s",async(text)=>{
    const result=await reply({},text);expect(result.status).toBe("clarify");expect(result.cast_request).toBeUndefined();
  });
  it("普通模糊问题没有起卦请求",async()=>{
    const result=await reply({goal:null,ambiguities:["缺少具体结果"]},"感情怎么样 3、6、8");
    expect(result.cast_request).toBeUndefined();expect(result.message).not.toContain("先冻结");
  });
  it("模型不可用不能起卦",async()=>{
    const llm=await import("../lib/server/divination-llm");vi.spyOn(llm,"extractQuestionContext").mockResolvedValue(null);
    const {continueDivinationChatWithLlm}=await import("../lib/divination/chat");
    const result=await continueDivinationChatWithLlm([{role:"user",content:"三个月能找到工作吗 3、6、8"}]);
    expect(result.status).toBe("clarify");expect(result.cast_request).toBeUndefined();
  });
  it("拒绝带 cast_request 的 clarify 以及规则伪 ready",async()=>{
    const result=await reply();
    expect(canCastChatReply({...result,status:"clarify"})).toBe(false);
    expect(canCastChatReply({...result,extraction:{source:"rules"}})).toBe(false);
    expect(canCastChatReply({...result,question_context:{...result.question_context,goal_groups:[]} as QuestionContext})).toBe(false);
  });
});
