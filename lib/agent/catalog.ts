import { guanyinSticks } from "@/lib/guanyin/library";
import { searchKnowledge } from "@/lib/knowledge/library";
import { resolvePythonBaseUrl } from "@/lib/server/python-client";
import type { PublicAgentSource } from "./types";

const baziConcepts: PublicAgentSource[] = [
  {
    id: "bazi-wuxing",
    kind: "bazi",
    title: "五行",
    source_id: "bazi-concept-wuxing",
    excerpt: "木、火、土、金、水五种基础属性，用于描述天干地支的生克制化关系。",
    url: "/knowledge",
  },
  {
    id: "bazi-ganzhi",
    kind: "bazi",
    title: "天干地支",
    source_id: "bazi-concept-ganzhi",
    excerpt: "十天干与十二地支组成干支体系，是四柱排盘的时间标记。",
    url: "/knowledge",
  },
  {
    id: "bazi-shishen",
    kind: "bazi",
    title: "十神",
    source_id: "bazi-concept-shishen",
    excerpt: "比肩、劫财、食神、伤官、偏财、正财、七杀、正官、偏印、正印。",
    url: "/knowledge",
  },
  {
    id: "bazi-day-master",
    kind: "bazi",
    title: "日主",
    source_id: "bazi-concept-day-master",
    excerpt: "日柱天干代表命主，是分析五行强弱和十神关系的中心。",
    url: "/bazi",
  },
];

function compact(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function containsAll(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}

function scoreText(title: string, excerpt: string, terms: string[]): number {
  return terms.reduce(
    (sum, term) =>
      sum +
      (title.toLowerCase().includes(term) ? 8 : 0) +
      (excerpt.toLowerCase().split(term).length - 1),
    0,
  );
}

function knowledgeKind(catalog: string): PublicAgentSource["kind"] {
  if (catalog.includes("八字") || catalog.includes("命理")) return "bazi";
  if (
    catalog.includes("占卜") ||
    catalog.includes("六爻") ||
    catalog.includes("易卦") ||
    catalog.includes("周易")
  ) {
    return "divination";
  }
  return "knowledge";
}

async function divinationCatalog(): Promise<PublicAgentSource[]> {
  const baseUrl = resolvePythonBaseUrl("divination");
  if (!baseUrl) return [];

  try {
    const response = await fetch(`${baseUrl}/divination/catalog`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      number: number;
      name: string;
      description: string;
    }>;
    return data.map((item) => ({
      id: `hexagram-${item.number}`,
      kind: "divination",
      title: `第 ${item.number} 卦 · ${item.name}`,
      source_id: `hexagram-${item.number}`,
      excerpt: item.description,
      url: "/divination",
    }));
  } catch {
    return [];
  }
}

export async function searchUnifiedAgentData(
  query: string,
  limit = 10,
): Promise<PublicAgentSource[]> {
  const rawTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!rawTerms.length) return [];

  const terms = rawTerms.map((term) => term.replace(/[，。！？、,.!?;；:：]/g, ""));
  const knowledge = searchKnowledge(query, 8).map((item) => ({
    id: item.id,
    kind: knowledgeKind(item.catalog),
    title: item.title,
    source_id: item.source,
    excerpt: item.excerpt,
    url: `/knowledge/${item.id}`,
  }));

  const guanyin = guanyinSticks
    .map((stick) => {
      const haystack = [
        `第 ${stick.id} 签`,
        stick.title,
        stick.poem.join(""),
        stick.traditional.jieyue,
        stick.traditional.xianji,
        Object.values(stick.traditional.topics).join(""),
      ].join(" ");
      return {
        source: {
          id: `guanyin-${stick.id}`,
          kind: "guanyin" as const,
          title: `第 ${stick.id} 签 · ${stick.title}`,
          source_id: `guanyin-${stick.id}`,
          excerpt: compact(`${stick.poem.join(" / ")} · ${stick.traditional.jieyue}`),
          url: "/guanyin",
        },
        score: scoreText(stick.title, haystack, terms),
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map((item) => item.source);

  const bazi = baziConcepts
    .map((item) => ({
      source: item,
      score: scoreText(item.title, item.excerpt, terms),
    }))
    .filter((item) => item.score > 0);

  const divination = (await divinationCatalog())
    .map((item) => ({
      source: item,
      score: scoreText(item.title, item.excerpt, terms),
    }))
    .filter((item) => item.score > 0)
    .slice(0, 6)
    .map((item) => item.source);

  return [...knowledge, ...guanyin, ...bazi.map((item) => item.source), ...divination]
    .filter((item) => containsAll(`${item.title} ${item.excerpt}`.toLowerCase(), terms))
    .slice(0, limit);
}
