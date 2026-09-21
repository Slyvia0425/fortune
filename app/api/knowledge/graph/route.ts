import {success} from "@/lib/contracts/api";
import {getKnowledgeGraph} from "@/lib/knowledge/library";
export async function GET(request:Request){const params=new URL(request.url).searchParams;const concept=params.get("concept")?.slice(0,50)||"五行";const depth=Number(params.get("depth")||2);return Response.json(success(getKnowledgeGraph(concept,depth),{system:"knowledge-graph-v3",warnings:[],mock:false}))}
