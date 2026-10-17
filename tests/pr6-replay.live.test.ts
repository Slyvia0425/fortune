import { loadEnvFile } from "node:process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

describe.skipIf(process.env.FORTUNE_PR6_REPLAY!=="1")("PR6 real model / same frozen 245 replay",()=>{
  it("runs ten uncached model analyses and publishes measured success/P95",async()=>{
    loadEnvFile(".env.local");
    const {loadJob245Replay}=await import("../lib/server/reasoning-replay");
    const {buildReasoningInput}=await import("../lib/divination/reasoning-input");
    const {runReasoningStage}=await import("../lib/server/reasoning-stage");
    const {validateStructuredReasoning,validateReasoningContext}=await import("../lib/divination/structured-reasoning");
    const {analysisHash}=await import("../lib/divination/analysis-utils");
    const {withWorkflowDeadline}=await import("../lib/server/workflow-budget");
    const {analysisModelIdentity}=await import("../lib/server/divination-llm");
    const source=process.env.FORTUNE_PR6_REPLAY_SOURCE??join(process.cwd(),".runtime/evals/pr1-pr6-job-245-1792053187550");
    const {context,migration}=await loadJob245Replay(source),built=buildReasoningInput(context);
    const root=join(process.cwd(),".runtime/evals",`pr6-production-replay-${Date.now()}`);await mkdir(root,{recursive:true,mode:0o700});
    const save=async(name:string,value:unknown)=>writeFile(join(root,name),JSON.stringify(value,null,2),{mode:0o600});
    const before=analysisHash(context),coreHash=analysisHash(context.frozen!.cast.core_facts);
    const codeFiles=["lib/server/divination-llm.ts","lib/server/workflow-budget.ts","lib/server/reasoning-config.ts","lib/server/structured-reasoning-llm.ts","lib/server/reasoning-stage.ts","lib/server/reasoning-diagnostics.ts","lib/server/reasoning-replay.ts",
      "lib/divination/reasoning-input.ts","lib/divination/reasoning-output.ts","lib/divination/structured-reasoning.ts","lib/divination/fact-claim-guard.ts"];
    const codeManifest=async()=>Object.fromEntries(await Promise.all(codeFiles.map(async file=>[file,analysisHash(await readFile(join(process.cwd(),file),"utf8"))])));
    const artifactFiles=["cast.json","confirmation.json","dialogue.json","interpretation.json"];
    const artifactManifest=async()=>Object.fromEntries(await Promise.all(artifactFiles.map(async file=>[file,analysisHash(await readFile(join(source,file),"utf8"))])));
    const codeAtStart=await codeManifest(),artifactsAtStart=await artifactManifest();
    await save("code-manifest.json",codeAtStart);await save("artifact-manifest.json",artifactsAtStart);
    const forward=context.planner.fact_catalog.facts.find(f=>f.subject_ref==="main:3"&&f.object_ref==="main:5");
    expect(forward?.value).toMatchObject({source_element:"土",target_element:"金",element_relation:"generates"});
    expect(context.planner.use_roles.primary?.main_line_refs).toEqual(["main:5"]);
    await save("migration.json",migration);await save("input.json",built.input);
    console.info(JSON.stringify({event:"replay_start",directory:root,chart_id:context.planner.chart_id,evidence_count:context.agent.snapshot.evidence.length,input_chars:JSON.stringify(built.input).length}));
    const runs:{run:number;status:string;elapsed_ms:number;diagnostic?:unknown;diagnostic_run_id?:string}[]=[];
    for(let i=0;i<10;i++){
      const started=Date.now(),store={load:async()=>null,save:async()=>{}};
      const result=await withWorkflowDeadline(()=>runReasoningStage("offline-replay",context,async()=>validateReasoningContext(context),{store}),Date.now()+150_000);
      if(result.status==="complete")validateStructuredReasoning(result.reasoning,context);
      expect(analysisHash(context)).toBe(before);expect(analysisHash(context.frozen!.cast.core_facts)).toBe(coreHash);
      await save(`run-${i+1}.json`,result);
      expect(await codeManifest(),"Concurrent code modification invalidates fixed-version benchmark").toEqual(codeAtStart);
      expect(await artifactManifest(),"Frozen replay source files must never be overwritten").toEqual(artifactsAtStart);
      runs.push({run:i+1,status:result.status,elapsed_ms:Date.now()-started,diagnostic:result.diagnostic,diagnostic_run_id:result.diagnostic_run_id??result.diagnostic?.diagnostic_run_id});
      const latencies=runs.map(r=>r.elapsed_ms).sort((a,b)=>a-b);
      const summary={source,chart_id:context.planner.chart_id,chart_hash:context.planner.chart_hash,model:analysisModelIdentity(),runs,
        completed_runs:runs.length,success_rate:runs.filter(r=>r.status==="complete").length/runs.length,partial_count:runs.filter(r=>r.status==="partial").length,
        failed_count:runs.filter(r=>r.status==="reasoning_failed").length,code_fingerprint:analysisHash(codeAtStart),source_files_fingerprint:analysisHash(artifactsAtStart),
        p95_ms:latencies[Math.ceil(.95*latencies.length)-1],p95_method:"nearest-rank; all runs including failures",input_chars:JSON.stringify(built.input).length,
        input_hash:built.input_hash,original_files_unchanged:JSON.stringify(JSON.parse(await readFile(join(source,"cast.json"),"utf8")).result.core_facts)===JSON.stringify(context.frozen!.cast.core_facts)};
      await save("summary.json",summary);console.info(JSON.stringify({event:"replay_run",...runs[runs.length-1],success_rate:summary.success_rate,p95_ms:summary.p95_ms}));
    }
    expect(runs).toHaveLength(10);
    // Success is measured, not assumed. Failures remain in the persisted denominator.
    console.info(JSON.stringify({event:"replay_end",directory:root,successes:runs.filter(r=>r.status==="complete").length,total:runs.length}));
  },1_600_000);
});
