import {describe,expect,it} from "vitest";
import {compareKnowledge,explainKnowledge,getKnowledgeGraph,knowledgeStats,searchKnowledge} from "../lib/knowledge/library";

describe("Module 3 knowledge service",()=>{
  it("loads the cleaned, section-level corpus",()=>{expect(knowledgeStats.pages).toBe(764);expect(knowledgeStats.sources.length).toBeGreaterThan(1)});
  it("finds classical passages by concept",()=>{const result=searchKnowledge("五行");expect(result.length).toBeGreaterThan(0);expect(result[0].score).toBeGreaterThan(0);expect(result[0].url).toMatch(/^https?:/)});
  it("filters results by content layer",()=>{const result=searchKnowledge("乾",12,"commentary");expect(result.length).toBeGreaterThan(0);expect(result.every(x=>x.category.includes("commentary"))).toBe(true)});
  it("returns a two-level explanatory graph",()=>{const graph=getKnowledgeGraph("五行");expect(graph.center).toBe("wuxing");expect(graph.nodes.length).toBeGreaterThan(12);expect(graph.edges.some(e=>e.source==="dizhi"&&e.target==="zi")).toBe(true)});
  it("builds a traceable comparison",()=>{const result=compareKnowledge("乾");expect(result.length).toBeGreaterThan(1);expect(new Set(result.map(x=>x.source)).size).toBeGreaterThan(1)});
  it("normalizes colloquial terms for the shared explanation API",()=>{const result=explainKnowledge("犯冲");expect(result.matched_term).toBe("相冲");expect(result.evidence_status).toBe("normalized");expect(result.explanation).toContain("现代口语")});
  it("marks unknown terms for an AI-labelled fallback",()=>{const result=explainKnowledge("完全不存在的测试词");expect(result.evidence_status).toBe("unsupported");expect(result.needs_llm).toBe(true)});
});
