// Post-run export only. Never calls a model or converts a failed draft to success.
import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
const dir=resolve(process.argv[2]);
const rows=JSON.parse(await readFile(join(dir,"11-all-nodes.json"),"utf8"));
const calls=rows.filter(r=>r.value.node==="model-call");
const raw=calls.at(-1).value.output.choices[0].content;
const draft=JSON.parse(raw),sections=draft.explainer.sections;
const text=["未通过格式/引用验收的原始模型草稿；不是正式成功结果。",...Object.entries({verdict:"断语",advice:"行动建议",analysis:"卦理分析"}).flatMap(([key,label])=>[label,...sections[key].map(p=>p.text+(p.evidence_ids?.length?`【原始引用：${p.evidence_ids.join(",")}】`:""))])].join("\n\n");
await writeFile(join(dir,"10-failed-model-draft.txt"),text,{mode:0o600,flag:"wx"});
await writeFile(join(dir,"10-failed-model-draft.raw.json"),raw,{mode:0o600,flag:"wx"});
console.log(JSON.stringify({directory:dir,source:"last_actual_model_attempt",official_status:"reasoning_failed",export_only:true}));
