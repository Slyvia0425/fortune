// Opt-in only: runs real paid model requests. Normal npm test skips this file.
// LIUYAO_EVAL_DIR must contain prepare_liuyao_e2e_eval.py's fixed inputs.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { interpretHybridEvidence } from "../lib/server/divination-llm";

import type { HybridEvidencePack, LiuyaoCoreFacts } from "../lib/contracts/divination";

const dir = process.env.LIUYAO_EVAL_DIR;
const resultFolder=process.env.LIUYAO_EVAL_RETRY==="1"?"model_results_retry1":"model_results";
type Fixture = {
  test_id:string; question:string; pack:HybridEvidencePack;
  chart:{facts:LiuyaoCoreFacts; chart_hash:string};
  expected:{candidate_role:string|null;chart_shape:string;must_abstain:boolean;
    required_rules:Array<{entity_revision_id:string;title:string}>};
  retrieval_check:{required:number;hit:number;missing:string[];rules:number;cases:number;vector_used:boolean};
};
const inputs:Fixture[] = dir ? JSON.parse(readFileSync(join(dir,"inputs.json"),"utf8")) : [];

describe.skipIf(!dir)("真实 core → 检索 → 生产模型 → Guardian 试测",()=>{
  it("固定题集包含12题",()=>expect(inputs).toHaveLength(12));
  for(const fixture of inputs){
    it(fixture.test_id,async()=>{
      // Resuming a run does not regenerate answers or overwrite previous failures.
      if(existsSync(join(dir!,resultFolder,fixture.test_id+".json")))return;
      const start=Date.now();
      let rawText:string|undefined;
      let responseMetadata:unknown;
      let requestBody:unknown;
      const requestBodies:unknown[]=[];
      const responseRecords:unknown[]=[];
      let status="not_called",error:string|undefined,result:Awaited<ReturnType<typeof interpretHybridEvidence>>|undefined;
      const originalFetch=globalThis.fetch;
      globalThis.fetch=async(input,init)=>{
        requestBody=typeof init?.body==="string"?JSON.parse(init.body):null;
        requestBodies.push(requestBody);
        const response=await originalFetch(input,init);
        if(response.ok){
          const payload=await response.clone().json();
          rawText=payload.choices?.[0]?.message?.content;
          responseMetadata={model:payload.model,usage:payload.usage,finish_reason:payload.choices?.[0]?.finish_reason};
        } else responseMetadata={http_status:response.status};
        responseRecords.push(responseMetadata);
        return response;
      };
      try {
        result=await interpretHybridEvidence(fixture.pack,fixture.chart.facts,fixture.question);
        status=result.status;
        if(result.status==="unavailable"&&result.attempts?.length) {
          status=result.attempts.at(-1)?.status==="request_error"?"request_error":"guardian_rejected";
          error=result.validation_errors?.map(e=>`${e.code}@${e.path}`).join("; ");
        }
      } catch(e){
        error=e instanceof Error?e.message:"UNKNOWN_ERROR";
        status=error==="MODEL_USE_ANALYSIS_INVALID"||e instanceof SyntaxError?"guardian_rejected":"request_error";
      } finally {globalThis.fetch=originalFetch;}
      const analysis=result?.analysis;
      const role=fixture.expected.candidate_role;
      const candidate=analysis?.candidates.find(c=>c.role===role);
      const roleRefs=new Set(analysis?.candidates.filter(c=>c.role===role).flatMap(c=>c.line_refs)??[]);
      const expectedIds=new Set(fixture.expected.required_rules.map(r=>r.entity_revision_id));
      const outputCitations=[...(analysis?.candidates.flatMap(c=>[...c.evidence_ids,...c.conditions.flatMap(x=>x.evidence_ids)])??[]),
        ...(analysis?.selection.evidence_ids??[]),...(result?.readings.flatMap(r=>r.evidence_ids)??[])];
      const selected=analysis?.selection.line_ref??null;
      const mainRefs=fixture.chart.facts.main_lines.filter(l=>l.kin===role).map(l=>l.ref);
      const hiddenRefs=fixture.chart.facts.hidden_lines.filter(l=>l.kin===role).map(l=>l.ref);
      const checks={
        production_guardian_pass:status==="generated",
        expected_role_present:role===null?null:!!candidate,
        expected_rule_cited:expectedIds.size===0?null:outputCitations.some(id=>expectedIds.has(id)),
        required_abstention:fixture.expected.must_abstain?status==="generated"&&selected===null:null,
        multiple_lines_retained:fixture.expected.chart_shape==="multiple"?mainRefs.every(ref=>roleRefs.has(ref)):null,
        hidden_line_retained:fixture.expected.chart_shape==="hidden"?hiddenRefs.some(ref=>roleRefs.has(ref)):null,
      };
      const diagnosticFlags=[...new Set(result?.validation_errors?.map(e=>e.code)??[])];
      const firstAttempt=result?.attempts?.[0];
      const row={test_id:fixture.test_id,status,error,elapsed_ms:Date.now()-start,
        response_metadata:responseMetadata,response_records:responseRecords,raw_output:rawText,production_result:result,
        first_attempt_pass:firstAttempt?.status==="accepted",repair_attempted:(result?.attempts?.length??0)>1,
        repair_succeeded:(result?.attempts?.length??0)>1&&status==="generated",
        attempt_records:result?.attempts??[],
        diagnostic_flags:diagnosticFlags,
        checks,retrieval_check:fixture.retrieval_check};
      const folder=join(dir!,resultFolder);mkdirSync(folder,{recursive:true});
      writeFileSync(join(folder,fixture.test_id+".json"),JSON.stringify(row,null,2));
      // Save exactly what was sent, never API keys or answer labels.
      writeFileSync(join(folder,fixture.test_id+".request.json"),JSON.stringify(requestBodies,null,2));
      console.log(JSON.stringify({test_id:fixture.test_id,status,checks}));
      // The harness records failures; a green harness is NOT a quality pass.
      expect(row.test_id).toBe(fixture.test_id);
    },200_000);
  }
});
