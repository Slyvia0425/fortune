import { mkdir, chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ReasoningIssue } from "../divination/reasoning-output";
import type { PlannerCallMetadata } from "./divination-llm";

export type ReasoningFailureKind="timeout"|"invalid_json"|"schema_invalid"|"invalid_reference"|"insufficient_evidence"|"transport_error";
export interface ReasoningAttemptDiagnostic {
  attempt:number;stage:"reasoning"|"writing";prompt_version:string;model:string;elapsed_ms:number;input_chars:number;output_chars:number;
  input_tokens:number|null;output_tokens:number|null;finish_reason:string|null;request_timeout_ms:number;
  outcome:"accepted"|ReasoningFailureKind;issues:ReasoningIssue[];raw_output:string|null;
}
export interface ReasoningRunDiagnostic {run_id:string;created_at:string;input_hash:string;attempts:ReasoningAttemptDiagnostic[]}
export type ReasoningDiagnosticSink=(run:ReasoningRunDiagnostic)=>Promise<void>;
export type ReasoningMetadata=Partial<PlannerCallMetadata>;
export async function saveReasoningDiagnostics(run:ReasoningRunDiagnostic,root=join(process.cwd(),".runtime","reasoning-diagnostics")){
  if(!/^[a-f0-9-]{36}$/.test(run.run_id))throw new Error("REASONING_DIAGNOSTIC_ID_INVALID");
  await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
  // Immutable per-attempt journals; no prompts, credentials, cookies or public KB writes.
  await writeFile(join(root,`${run.run_id}-${randomUUID()}.json`),JSON.stringify(run,null,2),{mode:0o600,flag:"wx"});
}
export function classifyReasoningFailure(error:unknown):ReasoningFailureKind{
  const name=error instanceof Error?error.name:"",code=error instanceof Error?error.message:"";
  if(["AbortError","TimeoutError"].includes(name)||/TIMEOUT|DEADLINE/.test(code))return "timeout";
  if(error instanceof SyntaxError||code==="MODEL_JSON_INVALID")return "invalid_json";
  if(/EVIDENCE_REQUIRED|UNSUPPORTED_STRENGTH|UNSUPPORTED_PREDICTION|INSUFFICIENT_CONCLUSION/.test(code))return "insufficient_evidence";
  if(/(?:FACT|TASK|EVIDENCE|IDENTITY|USE_ROLE|RELATION).*(?:INVALID|CHANGED|AMBIGUOUS)/.test(code))return "invalid_reference";
  if(/^(?:REASONING|WRITING)_/.test(code))return "schema_invalid";
  return "transport_error";
}
