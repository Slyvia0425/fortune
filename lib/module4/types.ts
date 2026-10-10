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
  created_at: string;
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
  metadata?: Record<string, unknown>;
}

export interface NoteDraft {
  noteId?: string;
  title: string;
  body: string;
  tags: string;
  sourceId: string;
  collectionId: string;
}
