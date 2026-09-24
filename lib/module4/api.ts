import type {
  ApiEnvelope,
  CollectionDraft,
  CollectionItem,
  DeleteDataResult,
  ExportJob,
  NoteDraft,
  NoteItem,
  PrivacySettings,
  TagItem,
} from "@/lib/module4/types";

export class Module4ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code = "REQUEST_FAILED",
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "Module4ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  return "/api/module4";
}

async function request<T>(
  path: string,
  _userId: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.error) {
    throw new Module4ApiError(
      payload.error?.message || `Request failed with status ${response.status}`,
      response.status,
      payload.error?.code,
      payload.error?.details,
    );
  }
  if (payload.result === null) {
    throw new Module4ApiError("The API returned no result", response.status, "EMPTY_RESULT");
  }
  return payload.result;
}

export const module4Api = {
  listCollections: (userId: string) =>
    request<CollectionItem[]>("/api/v1/me/collections", userId),

  createCollection: (userId: string, draft: CollectionDraft) =>
    request<CollectionItem>("/api/v1/me/collections", userId, {
      method: "POST",
      body: JSON.stringify({
        item_type: draft.itemType,
        source_id: draft.sourceId.trim(),
        title: draft.title.trim() || null,
        source_metadata: draft.sourceUrl.trim()
          ? { url: draft.sourceUrl.trim() }
          : {},
      }),
    }),

  deleteCollection: (userId: string, collectionId: string) =>
    request<void>(`/api/v1/me/collections/${encodeURIComponent(collectionId)}`, userId, {
      method: "DELETE",
    }),

  listNotes: (userId: string) => request<NoteItem[]>("/api/v1/me/notes", userId),

  saveNote: (userId: string, draft: NoteDraft) =>
    request<NoteItem>("/api/v1/me/notes", userId, {
      method: "POST",
      body: JSON.stringify({
        note_id: draft.noteId || null,
        source_id: draft.sourceId.trim() || null,
        collection_id: draft.collectionId || null,
        title: draft.title.trim() || null,
        body: draft.body.trim(),
        tags: draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    }),

  deleteNote: (userId: string, noteId: string) =>
    request<void>(`/api/v1/me/notes/${encodeURIComponent(noteId)}`, userId, {
      method: "DELETE",
    }),

  listTags: (userId: string) => request<TagItem[]>("/api/v1/me/tags", userId),

  createTag: (userId: string, name: string) =>
    request<TagItem>("/api/v1/me/tags", userId, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  deleteTag: (userId: string, tagId: string) =>
    request<void>(`/api/v1/me/tags/${encodeURIComponent(tagId)}`, userId, {
      method: "DELETE",
    }),

  getPrivacy: (userId: string) => request<PrivacySettings>("/api/v1/me/privacy", userId),

  updatePrivacy: (userId: string, settings: PrivacySettings) =>
    request<PrivacySettings>("/api/v1/me/privacy", userId, {
      method: "PUT",
      body: JSON.stringify({
        consent_scopes: settings.consent_scopes,
        retention_policy: settings.retention_policy,
        allow_anonymous_cases: settings.allow_anonymous_cases,
        allow_shared_training: settings.allow_shared_training,
      }),
    }),

  exportData: (userId: string) =>
    request<ExportJob>("/api/v1/me/exports", userId, { method: "POST" }),

  deleteAllData: (userId: string) =>
    request<DeleteDataResult>("/api/v1/me/data?confirm=true", userId, { method: "DELETE" }),
};
