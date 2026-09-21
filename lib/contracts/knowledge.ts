export type KnowledgeCategory = "original" | "commentary" | "translation" | "modern_commentary";

export interface KnowledgeSearchItem {
  id: string; title: string; source: string; catalog: string;
  category: KnowledgeCategory[]; excerpt: string; content: string;
  content_en?: string | null; url: string; score: number;
}

export interface KnowledgeGraphNode {
  id: string; label: string; type: "foundation" | "bazi" | "yijing" | "text";
  summary: string; sourceQuery: string;
}
export interface KnowledgeGraphEdge { source:string; target:string; relation:string }
export interface KnowledgeGraphResult { center:string; nodes:KnowledgeGraphNode[]; edges:KnowledgeGraphEdge[] }
export interface KnowledgePeriodView { period:string; meaning:string; focus:string }
export interface KnowledgeCompareResult {
  query:string;
  overview:string;
  differences:string;
  periods:KnowledgePeriodView[];
  viewpoints:Array<{source_id:string;title:string;source:string;catalog:string;category:KnowledgeCategory[];viewpoint:string;url?:string}>;
}

export type KnowledgeEvidenceStatus = "exact" | "normalized" | "unsupported";
export interface KnowledgeExplainResult {
  query:string; matched_term:string|null; explanation:string; normalized_terms:string[];
  evidence_status:KnowledgeEvidenceStatus; confidence:number; needs_llm:boolean;
  related_concepts:string[];
  evidence:Array<{source_id:string;title:string;catalog:string;category:KnowledgeCategory[];excerpt:string;url:string}>;
}
