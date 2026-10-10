import { module4Api } from "./api";
import type { CollectionItem } from "./types";

export type FortuneModule = "bazi" | "divination" | "guanyin" | "knowledge";

export interface FortuneActivity {
  module: FortuneModule;
  step: string;
  action: string;
  itemType: string;
  sourceId: string;
  title: string;
  summary: string;
  evidence?: string[];
  url?: string;
  tags?: string[];
  snapshot?: Record<string, unknown>;
  profileId?: string;
  personName?: string;
  personRelation?: string;
}

export type ConversationRole = "user" | "assistant";

export interface DivinationCompletionSnapshot {
  divinationId: string;
  question: string;
  timeRange?: string;
  method: string;
  primaryHexagram: Record<string, unknown>;
  changedHexagram: Record<string, unknown>;
  movingLines: number[];
  sourceRefs?: string[];
}

export function getModule4UserId(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_MODULE4_USER_ID || "dev-user";
  }
  return (
    window.localStorage.getItem("module4-user-id")?.trim() ||
    process.env.NEXT_PUBLIC_MODULE4_USER_ID ||
    "dev-user"
  );
}

export async function recordFortuneActivity(
  activity: FortuneActivity,
): Promise<CollectionItem> {
  const recordedAt = new Date().toISOString();
  return module4Api.createCollection(getModule4UserId(), {
    itemType: activity.itemType,
    sourceId: activity.sourceId,
    title: activity.title,
    sourceUrl: activity.url ?? "",
    sourceMetadata: {
      module: activity.module,
      category: activity.module,
      step: activity.step,
      action: activity.action,
      summary: activity.summary,
      evidence: activity.evidence ?? [],
      tags: activity.tags ?? [],
      recorded_at: recordedAt,
      snapshot: activity.snapshot ?? {},
      ...(activity.profileId ? { profile_id: activity.profileId } : {}),
      ...(activity.personName?.trim() ? { person_name: activity.personName.trim() } : {}),
      ...(activity.personRelation?.trim()
        ? { person_relation: activity.personRelation.trim() }
        : {}),
    },
  });
}

export function createSessionEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function recordConversationMessage(
  sessionId: string,
  role: ConversationRole,
  content: string,
  sequenceNo: number,
) {
  return module4Api.ingestSessionEvent(getModule4UserId(), {
    eventId: createSessionEventId(),
    sessionId,
    sourceModule: "module2a",
    eventType: "conversation.message",
    sequenceNo,
    system: "divination",
    payload: {
      role,
      content: content.trim(),
      history_only: true,
    },
  });
}

export async function recordDivinationCompletion(
  sessionId: string,
  snapshot: DivinationCompletionSnapshot,
  sequenceNo: number,
) {
  return module4Api.ingestSessionEvent(getModule4UserId(), {
    eventId: createSessionEventId(),
    sessionId,
    sourceModule: "module2a",
    eventType: "module2a.divination.completed",
    sequenceNo,
    system: "divination",
    payload: {
      divination_id: snapshot.divinationId,
      method: snapshot.method,
      primary_hexagram: snapshot.primaryHexagram,
      changed_hexagram: snapshot.changedHexagram,
      moving_lines: snapshot.movingLines,
      intent: {
        topic: snapshot.question,
        symbols: [
          snapshot.primaryHexagram.name,
          snapshot.changedHexagram.name,
        ].filter((value) => typeof value === "string" && value),
      },
      time_range: snapshot.timeRange,
      rule_version: "frontend-divination-v1",
    },
    sourceRefs: snapshot.sourceRefs ?? [],
  });
}
