import pages from "../../data/knowledge_sources_complete/knowledge_sources_pages.json";

export interface KnowledgePage {
  url: string;
  title: string;
  source: string;
  catalog: string;
  category: string[];
  content: string;
  content_en?: string;
  content_blocks?: KnowledgeContentBlock[];
}

export interface KnowledgeContentBlock {
  type: string;
  heading: string;
  text: string;
}

export interface KnowledgeSearchItem {
  id: string;
  title: string;
  source: string;
  catalog: string;
  category: string[];
  excerpt: string;
  url: string;
}

const records = pages as KnowledgePage[];

function knowledgeId(index: number): string {
  return `knowledge-${index}`;
}

function excerptOf(content: string): string {
  return `${content.replace(/[#*`\n]+/g, " ").trim().slice(0, 180)}…`;
}

export function searchKnowledge(query: string, limit = 12): KnowledgeSearchItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  return records
    .map((page, index) => {
      const title = page.title.toLowerCase();
      const catalog = page.catalog.toLowerCase();
      const hay = `${title} ${catalog} ${page.content}`.toLowerCase();
      const score = terms.reduce(
        (sum, term) =>
          sum +
          (title.includes(term) ? 8 : 0) +
          (catalog.includes(term) ? 4 : 0) +
          (hay.split(term).length - 1),
        0,
      );
      return { page, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ page, index }) => ({
      id: knowledgeId(index),
      title: page.title,
      source: page.source,
      catalog: page.catalog,
      category: page.category,
      excerpt: excerptOf(page.content),
      url: page.url,
    }));
}

export function getKnowledgePageById(id: string): KnowledgePage | undefined {
  const prefix = "knowledge-";
  if (!id.startsWith(prefix)) return undefined;
  const index = Number(id.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 && index < records.length
    ? records[index]
    : undefined;
}

const HEXAGRAM_TITLES = [
  "",
  "乾",
  "坤",
  "屯",
  "蒙",
  "需",
  "讼",
  "师",
  "比",
  "小畜",
  "履",
  "泰",
  "否",
  "同人",
  "大有",
  "谦",
  "豫",
  "随",
  "蛊",
  "临",
  "观",
  "噬嗑",
  "贲",
  "剥",
  "复",
  "无妄",
  "大畜",
  "颐",
  "大过",
  "坎",
  "离",
  "咸",
  "恒",
  "遁",
  "大壮",
  "晋",
  "明夷",
  "家人",
  "睽",
  "蹇",
  "解",
  "损",
  "益",
  "夬",
  "姤",
  "萃",
  "升",
  "困",
  "井",
  "革",
  "鼎",
  "震",
  "艮",
  "渐",
  "归妹",
  "丰",
  "旅",
  "巽",
  "兑",
  "涣",
  "节",
  "中孚",
  "小过",
  "既济",
  "未济",
] as const;

const TRADITIONAL_HEXAGRAM_TITLES: Record<string, string> = {
  贲: "賁",
  讼: "訟",
  师: "師",
  谦: "謙",
  随: "隨",
  蛊: "蠱",
  临: "臨",
  观: "觀",
  剥: "剝",
  复: "復",
  颐: "頤",
  恒: "恆",
  大壮: "大壯",
  遁: "遯",
  晋: "晉",
  损: "損",
  渐: "漸",
  丰: "豐",
  涣: "渙",
  节: "節",
  小过: "小過",
  既济: "既濟",
  未济: "未濟",
  离: "離",
  兑: "兌",
  归妹: "歸妹",
  大过: "大過",
};

function normalizedTitle(value: string): string {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{4DC0}-\u{4DFF}]/gu, "")
    .replace(/[《》〈〉\s]/g, "")
    .trim();
}

export function findHexagramKnowledgePage(number: number): KnowledgeSearchItem | undefined {
  if (!Number.isInteger(number) || number < 1 || number > 64) return undefined;
  const expected = HEXAGRAM_TITLES[number];
  const aliases = new Set([expected, TRADITIONAL_HEXAGRAM_TITLES[expected] ?? expected]);
  const match = records
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => {
      if (!page.catalog.includes("周易") || !page.catalog.includes("易经")) return false;
      return aliases.has(normalizedTitle(page.title));
    })
    .sort(
      (left, right) =>
        (right.page.content_blocks?.length ?? 0) - (left.page.content_blocks?.length ?? 0) ||
        left.index - right.index,
    )[0];
  if (!match) return undefined;
  return {
    id: knowledgeId(match.index),
    title: match.page.title,
    source: match.page.source,
    catalog: match.page.catalog,
    category: match.page.category,
    excerpt: excerptOf(match.page.content),
    url: match.page.url,
  };
}

export const knowledgeStats = {
  pages: records.length,
  sources: [...new Set(records.map((page) => page.source))],
};
