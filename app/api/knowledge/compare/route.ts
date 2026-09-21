import type {KnowledgeCompareResult} from "@/lib/contracts/knowledge";
import {failure,success} from "@/lib/contracts/api";
import {compareKnowledge,explainKnowledge,summarizeComparison} from "@/lib/knowledge/library";
export async function GET(request:Request){
  const query=new URL(request.url).searchParams.get("q")?.trim().slice(0,100)||"";
  if(!query)return failure("knowledge-compare-v4","VALIDATION_ERROR","请提供查询参数 q。");
  const matches=compareKnowledge(query);
  if(!matches.length){
    const explained=explainKnowledge(query);
    const normalized=explained.evidence_status==="normalized"&&explained.matched_term;
    const result:KnowledgeCompareResult={query,overview:explained.explanation,differences:normalized?`“${query}”是较常见的口语表达，传统资料中更适合检索“${explained.matched_term}”及相关概念。`:"当前知识库没有找到直接典籍依据；以下内容只作为术语理解提示，不构造虚假的历史观点。",periods:[{period:normalized?`规范术语：${explained.matched_term}`:"术语说明",meaning:explained.explanation,focus:normalized?"口语与传统术语的对应":"暂无直接典籍证据"}],viewpoints:explained.evidence.map(item=>({source_id:item.source_id,title:item.title,source:item.source_id.split("-")[0],catalog:item.catalog,category:item.category,viewpoint:item.excerpt,url:item.url}))};
    return Response.json(success(result,{system:"knowledge-compare-v4",sources:explained.evidence.map(x=>({source_id:x.source_id,title:x.title,chapter:x.catalog,url:x.url})),warnings:explained.needs_llm?["如需补充说明，应调用对话层LLM并标注为AI辅助解释。"]:[],mock:false}));
  }
  const synthesis=summarizeComparison(query);
  const result:KnowledgeCompareResult={query,...synthesis,viewpoints:matches.map(item=>({source_id:item.id,title:item.title,source:item.source,catalog:item.catalog,category:item.category,viewpoint:item.excerpt,url:item.url}))};
  return Response.json(success(result,{system:"knowledge-compare-v4",sources:matches.map(x=>({source_id:x.id,title:x.title,url:x.url})),warnings:matches.length<2?["可比较的来源不足两项。"]:[],mock:false}));
}
