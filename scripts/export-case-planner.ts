import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { P1_PROMPT } from "../lib/server/analysis-planner-llm";
import { taskRequirements } from "../lib/divination/analysis-plan";
import { TASK_KINDS, TOPICS, KIND_TOPICS } from "../lib/divination/topic-taxonomy";
import { redactTrace } from "../lib/server/case-trace";

const directory=process.argv[2];
if(!directory)throw new Error("Usage: vite-node scripts/export-case-planner.ts <saved-case-directory>");
const source=join(resolve(directory),"interpretation.json");
const {result}=JSON.parse(await readFile(source,"utf8"));
const p=result.initial_analysis;
if(!p?.fact_catalog||!p?.initial_plan)throw new Error("SAVED_PLANNER_REQUIRED");
const output={
  provenance:{source,kind:"historical_reconstruction",notice:"Input reconstructed from saved snapshot using current P1 builder/constants; not an archived wire request. Historical raw replies are unavailable. No model call or recast performed."},
  chart_id:p.chart_id,chart_hash:p.chart_hash,question_hash:p.question_hash,
  input:{system_prompt:P1_PROMPT,payload:{question_analysis:p.question_analysis,validated_use_roles:p.use_roles,fact_catalog:p.fact_catalog,
    allowed_task_kinds:TASK_KINDS,allowed_topics:TOPICS,kind_topics:KIND_TOPICS,required_coverage:taskRequirements(p.fact_catalog,p.question_analysis),max_tasks:7}},
  raw_model_outputs:null,
  final_validated_output:p.initial_plan,
};
const destination=join(resolve(directory),"planner-input-output.reconstructed.json");
await mkdir(resolve(directory),{recursive:true,mode:0o700});
await writeFile(destination,JSON.stringify(redactTrace(output),null,2),{mode:0o600,flag:"wx"});
console.log(destination);
