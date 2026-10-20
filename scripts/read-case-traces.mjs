import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const identifier=process.argv[2];
if(!identifier)throw new Error("Usage: node scripts/read-case-traces.mjs <chart/confirmation/conversation/trace UUID>");
const root=resolve(".runtime/case-traces"),runs=[];
for(const directory of await readdir(root).catch(()=>[])){
  try{const manifest=JSON.parse(await readFile(join(root,directory,"manifest.json"),"utf8"));runs.push({directory:join(root,directory),...manifest});}catch{/* Incomplete run. */}
}
const ids=new Set([identifier]),selected=new Map();
let added=true;
while(added){added=false;for(const run of runs){
  if(selected.has(run.run_id)||![run.run_id,...run.references??[]].some(id=>ids.has(id)))continue;
  selected.set(run.run_id,run);for(const ref of run.references??[])ids.add(ref);added=true;
}}
for(const run of [...selected.values()].sort((a,b)=>(a.created_at??"").localeCompare(b.created_at??""))){
  console.log(JSON.stringify({route:run.route,run_id:run.run_id,http_status:run.http_status,node_count:run.node_count,logging_status:run.logging_status,directory:run.directory}));
}
if(!selected.size)console.log("No saved trace found. Historical cases are not retroactively logged.");
