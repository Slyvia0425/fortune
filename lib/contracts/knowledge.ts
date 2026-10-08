import type { SourceReference } from "./api";

export interface KnowledgeSearchItem { id:string; title:string; source:string; catalog:string; category:string[]; excerpt:string; url:string }
export interface KnowledgeGraphResult { nodes:Array<{id:string;label:string;type:string}>; edges:Array<{source:string;target:string;relation:string}> }
export interface KnowledgeCompareResult { query:string; viewpoints:Array<{source_id:string;title:string;viewpoint:string;url?:string}> }

export interface HexagramLineEvidence {
  position: number;
  label: string;
  original: string;
  commentary: string[];
  translation_en?: string;
}

export interface HexagramSpecialLineEvidence {
  label: "用九" | "用六";
  original: string;
  commentary: string[];
  translation_en?: string;
}

export interface HexagramEvidenceResult {
  number: number;
  name: string;
  symbol: string;
  judgment: {
    original: string;
    commentary: string[];
    translation_en?: string;
  };
  lines: HexagramLineEvidence[];
  selected_line?: HexagramLineEvidence;
  special_line?: HexagramSpecialLineEvidence;
  sources: SourceReference[];
  coverage: {
    has_judgment: boolean;
    line_count: number;
    complete: boolean;
  };
}
