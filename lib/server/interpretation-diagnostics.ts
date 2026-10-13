import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type InterpretationStage = "generation" | "format" | "citations" | "coverage" | "semantic_review" | "review_format";
export class InterpretationFailure extends Error {
  constructor(public stage: InterpretationStage, public code: string, public reasons: string[]) { super(code); }
}
export const stageNames: Record<InterpretationStage, string> = { generation: "综合解释生成", format: "输出格式检查", citations: "引用检查", coverage: "规则与案例覆盖检查", semantic_review: "证据语义复核", review_format: "复核结果格式检查" };
export interface InterpretationDiagnostic { run_id:string; stage:InterpretationStage; code:string; reasons:string[]; log_saved:boolean }
export class RecordedInterpretationFailure extends Error {
  constructor(public diagnostic: InterpretationDiagnostic) { super(diagnostic.code); }
}
export interface InterpretationTrace { run_id:string; stage:InterpretationStage; calls:unknown[]; failures:unknown[] }
export function newInterpretationTrace(): InterpretationTrace { return {run_id:randomUUID(),stage:"generation",calls:[],failures:[]}; }
export async function saveInterpretationTrace(trace: InterpretationTrace, details: unknown) {
  const directory=join(process.cwd(),".runtime","interpretation-diagnostics");
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(join(directory,`${trace.run_id}.json`),JSON.stringify({...trace,created_at:new Date().toISOString(),details},null,2),{mode:0o600,flag:"wx"});
}
export function classifyInterpretationFailure(error: unknown, trace: InterpretationTrace): InterpretationDiagnostic {
  if (error instanceof InterpretationFailure) return {run_id:trace.run_id,stage:error.stage,code:error.code,reasons:error.reasons,log_saved:false};
  if (error instanceof Error && /^LLM_SERVICE_\d+$/.test(error.message)) return {run_id:trace.run_id,stage:trace.stage,code:"MODEL_HTTP_ERROR",reasons:[`模型服务 HTTP 状态：${error.message.replace("LLM_SERVICE_", "")}`],log_saved:false};
  if (error instanceof Error && error.message === "LLM_EMPTY_INTERPRETATION") return {run_id:trace.run_id,stage:trace.stage,code:"MODEL_EMPTY_RESPONSE",reasons:["模型响应缺少文本 content。"],log_saved:false};
  const timeout=error instanceof Error && ["AbortError","TimeoutError"].includes(error.name);
  return {run_id:trace.run_id,stage:trace.stage,code:timeout?"MODEL_TIMEOUT":"MODEL_REQUEST_OR_RESPONSE_ERROR",reasons:[timeout?"模型请求超时。":"模型请求失败或响应无法解析。"],log_saved:false};
}
