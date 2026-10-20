// Export only an already-completed frozen replay; never calls a model or casts.
import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import assert from "node:assert/strict";
const dir=resolve(process.argv[2]);
const payload=JSON.parse(await readFile(join(dir,"3-interpret.json"),"utf8")),r=payload.result;
const report=r.structured_reasoning?.explainer;
assert.ok(report,"No validated explainer in this replay; do not export an unverified draft");
assert.deepEqual(r.modern_interpretation.explainer,report);
const save=(name,value)=>writeFile(join(dir,name),typeof value==="string"?value:JSON.stringify(value,null,2),{mode:0o600,flag:"wx"});
await save("explainer-report.actual.json",report);
await save("explainer-report.actual.txt",r.modern_interpretation.overall_interpretation+"\n\n"+r.modern_interpretation.disclaimer);
const audit={chart_id:r.initial_analysis.chart_id,chart_hash:r.initial_analysis.chart_hash,question_hash:r.initial_analysis.question_hash,
  analysis_status:r.analysis_status,assessment:r.structured_reasoning.overall_assessment.status,
  claims:report.claims.map(claim=>({...claim,source_material:claim.evidence_ids.map(id=>report.citations.find(c=>c.evidence_id===id)),findings:claim.basis_finding_ids.map(id=>r.structured_reasoning.findings.find(f=>f.finding_id===id))})),
  gaps:report.gap_impacts,unresolved:r.structured_reasoning.unresolved_questions,
  verification_boundary:report.validation_mode==="integrity"?"Data identity, schema, real citations and task ownership checked only. Rule applicability, prose semantics and prediction strength are NOT program-validated.":"IDs, excerpts, task lineage, explicit fact comparisons and strength bounds checked. These checks are not proof of semantic entailment; key applications need source-by-source review."};
await save("claim-source-audit.actual.json",audit);
console.log(JSON.stringify({directory:dir,analysis_status:r.analysis_status,claims:report.claims.length,citations:report.citations.length,text:r.modern_interpretation.overall_interpretation},null,2));
