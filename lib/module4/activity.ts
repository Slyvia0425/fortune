import { module4Api } from "@/lib/module4/api";
import type { CollectionItem } from "@/lib/module4/types";

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
