import { describe, expect, it } from "vitest";
import { CoreInputError, buildAnalysisPlan, emptyQuestionContext, freezeCastInput } from "../lib/divination/core";

describe("三数字 Core 输入冻结", () => {
  it("保留输入顺序并冻结一次性时间和方法元数据", () => {
    const receipt = freezeCastInput(
      { question: "我能否收到货款", method: "three_numbers", numbers: [18, 27, 9], timezone: "Asia/Hong_Kong", request_id: "request-1" },
      new Date("2026-10-09T01:02:03.000Z"),
    );
    expect(receipt.raw_numbers).toEqual([18, 27, 9]);
    expect(receipt.validated_numbers).toEqual([18, 27, 9]);
    expect(receipt.request_id).toBe("request-1");
    expect(receipt.cast_at).toBe("2026-10-09T01:02:03.000Z");
    expect(receipt.timezone).toBe("Asia/Hong_Kong");
  });

  it("拒绝两个数字和无效时区", () => {
    expect(() => freezeCastInput({ question: "测试", method: "three_numbers", numbers: [1, 2] as unknown as [number, number, number] })).toThrow(CoreInputError);
    expect(() => freezeCastInput({ question: "测试", method: "three_numbers", numbers: [1, 2, 3], timezone: "invalid/zone" })).toThrow("IANA");
  });

  it("问题歧义不会阻止排盘契约，但会阻止规则选择", () => {
    const context = emptyQuestionContext("工作怎么样");
    context.ambiguities.push("未说明录用、合同、薪酬或在职发展");
    expect(buildAnalysisPlan(context)).toMatchObject({ status: "needs_clarification", precision_limit: "insufficient", candidate_ids: [] });
  });
});
