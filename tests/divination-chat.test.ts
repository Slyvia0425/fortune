import {describe,expect,it} from "vitest";
import {continueDivinationChat} from "../lib/divination/chat";

describe("问卦 chatbot",()=>{
  it("问题和时间明确但缺少数字时追问",()=>{
    const reply=continueDivinationChat([{role:"user",content:"我想问未来三个月的工作安排"}]);
    expect(reply.status).toBe("clarify");
    expect(reply.message).toContain("两个正整数");
  });
  it("识别明天为有效的相对时间",()=>{
    const reply=continueDivinationChat([{role:"user",content:"我明天要不要去 career"}]);
    expect(reply.status).toBe("clarify");
    expect(reply.message).toContain("两个正整数");
    expect(reply.message).not.toContain("时间范围");
  });
  it("信息齐全时返回确定性的数字起卦请求",()=>{
    const reply=continueDivinationChat([{role:"user",content:"我想用六爻问未来三个月的工作，数字 18 和 27"}]);
    expect(reply.status).toBe("ready");
    expect(reply.cast_request).toMatchObject({method:"numbers",numbers:[18,27],time_range:"未来三个月"});
  });
  it("不在易卦对话中调度灵签",()=>{
    const reply=continueDivinationChat([{role:"user",content:"抽观音灵签问今年的感情"}]);
    expect(reply.status).toBe("clarify");
    expect(reply.message).toContain("灵签");
    expect(reply).not.toHaveProperty("guanyin_request");
  });
});
