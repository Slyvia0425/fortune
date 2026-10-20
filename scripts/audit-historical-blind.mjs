// Post-run integrity audit only. Reference images/answers are never read here.
import {readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
const dir=resolve(process.argv[2]);
const read=async name=>JSON.parse(await readFile(join(dir,name),"utf8"));
const [rows,input,result,context]=await Promise.all([read("11-all-nodes.json"),read("08-reasoning-input.json"),read("09-result.json"),read("07-context.json")]);
const ids=new Set(input.evidence.map(e=>e.evidence_id)),calls=rows.filter(r=>r.value.node==="model-call");
const modelAttempts=calls.map(r=>{
  const raw=r.value.output?.choices?.[0]?.content,d=raw?JSON.parse(raw):null;
  const invalid=[];
  for(const [i,f] of (d?.findings??[]).entries())for(const id of f.evidence_ids??[])if(!ids.has(id))invalid.push({path:`findings[${i}].evidence_ids`,id});
  for(const [name,paragraphs] of Object.entries(d?.explainer?.sections??{}))for(const [i,p] of paragraphs.entries())for(const id of p.evidence_ids??[])if(!ids.has(id))invalid.push({path:`explainer.sections.${name}[${i}].evidence_ids`,id});
  const serialized=JSON.stringify(r.value.input);
  const forbidden=["8月14","8 月 14","二审","二審","原判","codex-clipboard","参考答案","新证据","新證據"].filter(s=>serialized.includes(s));
  return {request_sha256:createHash("sha256").update(serialized).digest("hex"),model:r.value.output?.model,elapsed_ms:r.value.elapsed_ms,
    root_keys:Object.keys(d??{}),unexpected_root_keys:Object.keys(d??{}).filter(k=>!["findings","synthesis","explainer"].includes(k)),invalid_evidence_ids:invalid,forbidden_input_markers:forbidden};
});
const audit={phase:"post_run_no_reference_loaded",official_status:result.status,model_attempts:modelAttempts,
  source_excerpt_integrity:"mergeEvidence and validateReasoningContext validated original source hashes/spans and snapshot replay provenance before the model call",
  citations:result.reasoning?.explainer?.citations??null,
  actual_calendar:context.frozen.cast.core_facts.calendar,final_report_validation_mode:result.reasoning?.validation_mode??null,
  final_report_note:result.status==="complete"?"Data/reference completeness only, no semantic certification":"Failed model draft is not a successful validated report"};
await writeFile(join(dir,"12-request-reference-audit.json"),JSON.stringify(audit,null,2),{mode:0o600,flag:"wx"});
console.log(JSON.stringify({directory:dir,status:result.status,attempts:modelAttempts}));
