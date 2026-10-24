import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InterpretationPanel from "../app/divination/interpretation-panel";
import type { DivinationInterpretationResult } from "../lib/contracts/divination";
import { reasoningFixture, reasoningDraft } from "./fixtures/reasoning-fixture";

function result():DivinationInterpretationResult{
  const c=reasoningFixture();return {modern_interpretation:null,analysis_status:"structured_available",structured_reasoning:reasoningDraft(c),evidence_snapshot:c.agent.snapshot,
    evidence_pack:{rule_version:"changing-lines-v1",selection_rule:"test",question:c.question,primary:{number:17,name:"随",upper_trigram:"兑",lower_trigram:"震",five_element_relation:"金木关系"},transformed:{number:43,name:"夬",upper_trigram:"兑",lower_trigram:"乾"},moving_lines:[1],evidence:[],sources:[]}};
}
describe("PR-6 structured result display",()=>{
  it("separates workflow completion from conditional substantive assessment",()=>{
    const r=result();r.analysis_status="complete";
    const html=renderToStaticMarkup(createElement(InterpretationPanel,{result:r}));
    expect(html).toContain("流程状态：已完成");expect(html).toContain("理论分析结论：有条件");
    expect(html).toContain("流程完成不代表现实结果已确定");
  });
  it("写作失败仍能查看观察与来源，但不展示条件局限清单",()=>{
    const r=result(),html=renderToStaticMarkup(createElement(InterpretationPanel,{result:r}));
    expect(html).toContain("结构化分析已保留");expect(html).not.toContain("原文适用条件仍待核验");expect(html).toContain(r.evidence_snapshot!.evidence[0].text);expect(html).toContain("source1");
  });
  it("推理未通过不能只提示旧式自由解读重试",()=>{
    const r=result();delete r.structured_reasoning;r.analysis_status="reasoning_failed";
    expect(renderToStaticMarkup(createElement(InterpretationPanel,{result:r}))).toContain("未绕过校验生成解读");
  });
});

it("高级分析失败时在页面显示独立标记的基础解释",async()=>{
  const {basicExplanation}=await import("../lib/divination/basic-explanation");
  const r=result();delete r.structured_reasoning;r.analysis_status="reasoning_failed";
  r.basic_interpretation=basicExplanation(r.evidence_pack);
  const html=renderToStaticMarkup(createElement(InterpretationPanel,{result:r}));
  expect(html).toContain("基础文本解释");expect(html).toContain("本次问事");expect(html).toContain("随");
});
