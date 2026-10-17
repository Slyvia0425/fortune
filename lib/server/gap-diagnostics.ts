import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ValidationIssue } from "../divination/gap-proposals";

export interface GapAttemptDiagnostic {
  attempt:number; phase:"initial"|"repair"; raw_output:string|null;
  validation_issues:ValidationIssue[]; outcome:"accepted"|"rejected"; error_code?:string; elapsed_ms:number;
}
export interface GapDiagnosticRun {run_id:string;created_at:string;chart_hash:string;plan_hash:string;attempts:GapAttemptDiagnostic[]}
// Private diagnostic data, not a public knowledge source. Do not separately log
// prompts/questions, credentials, cookies or headers. Raw text may contain user data.
export async function saveGapDiagnostics(run:GapDiagnosticRun,root=path.join(process.cwd(),".runtime","gap-diagnostics")):Promise<void>{
  if(!/^[a-f0-9-]{36}$/.test(run.run_id))throw new Error("GAP_DIAGNOSTIC_ID_INVALID");
  await mkdir(root,{recursive:true,mode:0o700});
  await chmod(root,0o700);
  const file=await open(path.join(root,`${run.run_id}-${randomUUID()}.json`),"wx",0o600);
  try{await file.writeFile(JSON.stringify(run,null,2));}finally{await file.close();}
}
