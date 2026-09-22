export interface ApiErrorDetail {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  result: T | null;
  source_refs: string[];
  system: string;
  session_id: string | null;
  warnings: string[];
  error: ApiErrorDetail | null;
}

export interface CollectionItem {
  collection_id: string;
  user_id: string;
  item_type: string;
  source_id: string | null;
  snapshot_id: string | null;
  title: string | null;
  source_metadata: Record<string, unknown>;
  tags?: string[];
  category?: string | null;
  created_at: string;
}

export interface NoteItem {
  note_id: string;
  user_id: string;
  source_id: string | null;
  collection_id: string | null;
  title: string | null;
  body: string;
  tags: string[];
  source_refs: string[];
  created_at: string;
  updated_at: string;
}

export interface TagItem {
  tag_id: string;
  name: string;
  usage_count?: number;
  created_at: string;
}

export interface PersonProfile {
  profile_id: string;
  user_id: string;
  name: string;
  relation: string | null;
  gender: string | null;
  calendar: string | null;
  birth_date: string | null;
  birth_time: string | null;
  birth_place: Record<string, unknown>;
  chart_snapshot: Record<string, unknown>;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonProfileUpsertDraft {
  profileId?: string;
  name: string;
  relation?: string;
  gender?: string;
  calendar?: string;
  birthDate?: string;
  birthTime?: string;
  birthPlace?: Record<string, unknown>;
  chartSnapshot?: Record<string, unknown>;
  tags?: string[];
  notes?: string;
}

export interface AgentUsedRecord {
  id: string;
  title: string;
  source_id: string | null;
  item_type: string;
  excerpt: string;
  module: string | null;
  tags: string[];
  url: string | null;
}

export interface AgentAnalysis {
  answer: string;
  person: PersonProfile | null;
  observations: string[];
  suggestions: string[];
  uncertainties: string[];
  used_records: AgentUsedRecord[];
  source_refs: string[];
  model: string;
}

export interface PrivacySettings {
  user_id: string;
  consent_scopes: string[];
  retention_policy: string;
  allow_anonymous_cases: boolean;
  allow_shared_training: boolean;
  updated_at: string;
}

export interface ExportJob {
  export_id: string;
  user_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  source_manifest: string[];
  data: Record<string, unknown>;
}

export interface DeleteDataResult {
  user_id: string;
  status: string;
  deleted_at: string;
  deleted_counts: Record<string, number>;
}

export interface CollectionDraft {
  itemType: string;
  sourceId: string;
  title: string;
  sourceUrl: string;
  category?: string;
  tags?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface CollectionUpdateDraft {
  title?: string;
  tags?: string[];
  category?: string | null;
  sourceMetadata?: Record<string, unknown>;
}

export interface NoteDraft {
  noteId?: string;
  title: string;
  body: string;
  tags: string;
  sourceId: string;
  collectionId: string;
}
