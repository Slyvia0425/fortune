export type AgentSourceKind =
  | "collection"
  | "note"
  | "knowledge"
  | "guanyin"
  | "divination"
  | "bazi";

export interface PublicAgentSource {
  id: string;
  kind: AgentSourceKind;
  title: string;
  source_id: string | null;
  excerpt: string;
  url: string | null;
}
