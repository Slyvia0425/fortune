import { expect, it } from "vitest";
import { classifyInterpretationFailure, InterpretationFailure, newInterpretationTrace } from "../lib/server/interpretation-diagnostics";
it.each([
  ["format","SYNTHESIS_JSON_INVALID"],
  ["citations","SYNTHESIS_CITATION_INVALID"],
  ["coverage","SYNTHESIS_REVIEW_COVERAGE_INVALID"],
  ["semantic_review","SEMANTIC_REVIEW_REJECTED"],
  ["review_format","SEMANTIC_REVIEW_FORMAT_INVALID"],
] as const)("保留 %s 的具体原因", (stage,code)=>{
  const trace=newInterpretationTrace();
  expect(classifyInterpretationFailure(new InterpretationFailure(stage,code,["具体失败原因"]),trace)).toMatchObject({stage,code,reasons:["具体失败原因"],run_id:trace.run_id});
});
it("复核网络超时不能误报引用失败",()=>{
 const trace=newInterpretationTrace();trace.stage="semantic_review";
 const error=new Error("sensitive transport text");error.name="TimeoutError";
 expect(classifyInterpretationFailure(error,trace)).toMatchObject({stage:"semantic_review",code:"MODEL_TIMEOUT",reasons:["模型请求超时。"]});
});
