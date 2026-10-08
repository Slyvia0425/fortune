import pages from "../../data/knowledge_sources_complete/knowledge_sources_pages.json";
import type { SourceReference } from "@/lib/contracts/api";
import type { HexagramEvidenceResult, HexagramLineEvidence, HexagramSpecialLineEvidence } from "@/lib/contracts/knowledge";

type ContentBlock = { type: string; heading: string; text: string };
type KnowledgePage = {
  url: string;
  title: string;
  source: string;
  source_name: string;
  catalog: string;
  content: string;
  content_en?: string | null;
  content_blocks?: ContentBlock[];
};

type IndexedHexagram = Omit<HexagramEvidenceResult, "selected_line"> & { aliases: string[] };

const records = pages as KnowledgePage[];
const ZHOUYI_CATALOG = "经典文献 -> 周易 -> 易经";

const traditionalCharacters: Record<string, string> = {
  讼: "訟", 师: "師", 谦: "謙", 随: "隨", 蛊: "蠱", 临: "臨", 观: "觀",
  贲: "賁", 剥: "剝", 颐: "頤", 过: "過", 离: "離", 恒: "恆", 遁: "遯",
  壮: "壯", 晋: "晉", 损: "損", 归: "歸", 丰: "豐", 兑: "兌", 涣: "渙",
  节: "節", 济: "濟",
};

function normalizeName(value: string) {
  return [...value.trim().replace(/[\u4dc0-\u4dff\s·「」『』]/gu, "")]
    .map((character) => traditionalCharacters[character] ?? character)
    .join("");
}

function hexagramNumber(title: string) {
  const point = title.codePointAt(0);
  return point && point >= 0x4dc0 && point <= 0x4dff ? point - 0x4dc0 + 1 : null;
}

function englishOriginals(content: string | null | undefined) {
  if (!content) return [];
  const sections = [...content.matchAll(/^## ([^\n]+)\n\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  return sections
    .filter((match) => !/(Tuan Zhuan|Xiang Zhuan|Wen Yan)/i.test(match[1]))
    .map((match) => match[2].trim());
}

function cleanOriginal(text: string) {
  return text.replace(/^\s+|\s+$/g, "");
}

function buildIndex() {
  const ctextPages = records.filter(
    (page) => page.source === "ctext" && page.catalog.includes(ZHOUYI_CATALOG) && hexagramNumber(page.title),
  );
  const wikiPages = records.filter(
    (page) => page.source === "wikisource" && page.catalog.includes(ZHOUYI_CATALOG),
  );

  return ctextPages
    .map((page): IndexedHexagram | null => {
      const number = hexagramNumber(page.title);
      if (!number) return null;

      const originals: Array<{ text: string; commentary: string[] }> = [];
      for (const block of page.content_blocks ?? []) {
        if (block.type === "original") {
          originals.push({ text: cleanOriginal(block.text), commentary: [] });
        } else if (block.type === "commentary" && originals.length) {
          originals.at(-1)?.commentary.push(cleanOriginal(block.text));
        }
      }

      const translations = englishOriginals(page.content_en);
      const name = page.title.slice(1).trim();
      const wikiPage = wikiPages.find((candidate) => candidate.content.includes(`第${toChineseNumber(number)}卦`))
        ?? wikiPages[number - 1];
      const sources: SourceReference[] = [
        { source_id: `ctext-zhouyi-${number}`, title: `《周易》${name}卦`, edition: "中国哲学书电子化计划", chapter: `第${number}卦`, url: page.url },
      ];
      if (wikiPage) {
        sources.push({ source_id: `wikisource-zhouyi-${number}`, title: `《周易》${wikiPage.title}卦`, edition: "维基文库", chapter: `第${number}卦`, url: wikiPage.url });
      }

      const lines: HexagramLineEvidence[] = originals.slice(1, 7).map((entry, index) => ({
        position: index + 1,
        label: entry.text.split(":", 1)[0] || `第${index + 1}爻`,
        original: entry.text,
        commentary: entry.commentary,
        translation_en: translations[index + 1],
      }));
      const special = originals.find((entry) => /^用[九六]:/.test(entry.text));
      const specialLine: HexagramSpecialLineEvidence | undefined = special
        ? {
            label: special.text.startsWith("用九:") ? "用九" : "用六",
            original: special.text,
            commentary: special.commentary,
          }
        : undefined;

      const aliases = [name, wikiPage?.title ?? ""].map(normalizeName).filter(Boolean);
      return {
        number,
        name,
        symbol: page.title[0],
        judgment: {
          original: originals[0]?.text ?? "",
          commentary: originals[0]?.commentary ?? [],
          translation_en: translations[0],
        },
        lines,
        special_line: specialLine,
        sources,
        coverage: {
          has_judgment: Boolean(originals[0]?.text),
          line_count: lines.length,
          complete: Boolean(originals[0]?.text) && lines.length === 6,
        },
        aliases,
      };
    })
    .filter((entry): entry is IndexedHexagram => entry !== null)
    .sort((a, b) => a.number - b.number);
}

function toChineseNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value];
  if (value === 10) return "十";
  if (value < 20) return `十${digits[value % 10]}`;
  const tens = `${digits[Math.floor(value / 10)]}十`;
  return value % 10 ? `${tens}${digits[value % 10]}` : tens;
}

const hexagrams = buildIndex();
const byNumber = new Map(hexagrams.map((entry) => [entry.number, entry]));

export const hexagramKnowledgeStats = {
  indexed_hexagrams: hexagrams.length,
  complete_hexagrams: hexagrams.filter((entry) => entry.coverage.complete).length,
  indexed_lines: hexagrams.reduce((total, entry) => total + entry.lines.length, 0),
};

export function getHexagramEvidence(query: { number?: number; name?: string; line?: number }) {
  let entry = query.number ? byNumber.get(query.number) : undefined;
  if (!entry && query.name) {
    const normalized = normalizeName(query.name);
    entry = hexagrams.find((candidate) => candidate.aliases.some((alias) => normalized === alias || normalized.endsWith(alias)));
  }
  if (!entry) return null;

  const { aliases: _aliases, ...result } = entry;
  void _aliases;
  return {
    ...result,
    selected_line: query.line ? result.lines.find((line) => line.position === query.line) : undefined,
  } satisfies HexagramEvidenceResult;
}
