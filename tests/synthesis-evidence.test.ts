import { expect, it } from "vitest";
import { validateSynthesisReview } from "../lib/divination/synthesis-evidence";
const fixture = () => ({ rule_applicability:[{evidence_id:"R1",status:"excluded",original_scope:"延师",question_match:"不符合求职",reason:"专题不同"}], case_comparisons:[{evidence_id:"C1",status:"applicable",similarities:"职位",differences:"盘面不同",lesson:"不能套结局"}], contextual_reflections:[{text:"案例对照",evidence_ids:["C1"]}] });
it("不允许遗漏案例比较",()=>{const output=fixture();output.case_comparisons=[];expect(()=>validateSynthesisReview(output,["R1"],["C1"])).toThrow();});
it("不允许用已排除规则支持结论",()=>{const output=fixture();output.contextual_reflections[0].evidence_ids.push("R1");expect(()=>validateSynthesisReview(output,["R1"],["C1"])).toThrow();});
it("可比案例必须进入有引用的分析",()=>{const output=fixture();output.contextual_reflections=[];expect(()=>validateSynthesisReview(output,["R1"],["C1"])).toThrow();});
it("完整比较通过结构检查",()=>expect(()=>validateSynthesisReview(fixture(),["R1"],["C1"])).not.toThrow());
