import {describe,expect,it} from "vitest";
import {continueDivinationChat} from "../lib/divination/chat";

describe("问卦 chatbot",()=>{
  it("问题和时间明确但缺少数字时追问",()=>{
    const reply=continueDivinationChat([{role:"user",content:"我想问未来三个月的工作安排"}]);
    expect(reply.status).toBe("clarify");
    expect(reply.message).toContain("恰好三个整数");
  });
  it("识别明天为有效的相对时间",()=>{
    const reply=continueDivinationChat([{role:"user",content:"我明天要不要去 career"}]);
    expect(reply.status).toBe("clarify");
    expect(reply.message).toContain("恰好三个整数");
  });
  it("信息齐全时返回确定性的数字起卦请求",()=>{
    const reply=continueDivinationChat([{role:"user",content:"我想用六爻问未来三个月的工作，数字 18、27、9"}]);
    expect(reply.status).toBe("ready");
    expect(reply.cast_request).toMatchObject({method:"three_numbers",numbers:[18,27,9]});
  });
  it("后续单独提供的三数字不计入先前的零散数字",()=>{
    const reply=continueDivinationChat([
      {role:"user",content:"我下个月能找到实习吗 34"},
      {role:"assistant",content:"请提供三个数字。"},
      {role:"user",content:"12 45 66"},
      {role:"assistant",content:"请重新确认数字。"},
      {role:"user",content:"18、27、9"},
    ]);
    expect(reply.status).toBe("ready");
    expect(reply.cast_request?.numbers).toEqual([18,27,9]);
  });
  it("不在易卦对话中调度灵签",()=>{
    const reply=continueDivinationChat([{role:"user",content:"抽观音灵签问今年的感情"}]);
    expect(reply.status).toBe("clarify");
    expect(reply.message).toContain("灵签");
    expect(reply).not.toHaveProperty("guanyin_request");
  });
});
