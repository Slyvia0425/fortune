import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import links from "@/lib/bazi/knowledge-links.json";
import { BAZI_TERMS, knowledgeSourceHref, knowledgeTermHref } from "@/lib/bazi/knowledge-links";
import { getKnowledgePageById, searchKnowledge } from "@/lib/knowledge/library";
import pages from "../data/knowledge_sources_complete/knowledge_sources_pages.json";

const corpusUrls = new Set((pages as { url: string }[]).map((page) => page.url));

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return path.endsWith(".json") ? [path] : [];
  });
}

/** Every URL the Bazi rule base and the classic cases cite. */
function citedUrls(): Set<string> {
  const found = new Set<string>();
  const sources = [...jsonFiles("python_algorithm/bazi"), "lib/bazi/classic-cases.json"];
  for (const file of sources) {
    for (const match of readFileSync(file, "utf8").matchAll(/"kb_url":\s*"([^"]+)"/g)) found.add(match[1]);
  }
  return found;
}

describe("八字引用与典籍页面的对应", () => {
  it("每个对应项都指向典籍里确实存在的、来自同一网址的页面", () => {
    for (const [url, id] of Object.entries(links as Record<string, string>)) {
      const page = getKnowledgePageById(id);
      expect(page, `${id} 在典籍库里不存在`).not.toBeNull();
      expect(page?.url).toBe(url);
    }
  });

  it("典籍库里有的引用页面都登记了对应项，没有的保持原链接", () => {
    for (const url of citedUrls()) {
      if (corpusUrls.has(url)) expect(knowledgeSourceHref(url), `${url} 缺少对应项`).not.toBeNull();
      else expect(knowledgeSourceHref(url)).toBeNull();
    }
  });

  it("未知或为空的网址不生成内部链接", () => {
    expect(knowledgeSourceHref(null)).toBeNull();
    expect(knowledgeSourceHref("https://example.com/none")).toBeNull();
  });

  it("术语链接用到的术语都能在典籍里检索到资料", () => {
    const terms = [BAZI_TERMS.dayMaster, ...Object.values(BAZI_TERMS.group)];
    for (const term of terms) {
      expect(searchKnowledge(term, 1).length, `${term} 没有检索结果`).toBeGreaterThan(0);
      expect(knowledgeTermHref(term)).toBe(`/knowledge/term/${encodeURIComponent(term)}`);
    }
  });
});
