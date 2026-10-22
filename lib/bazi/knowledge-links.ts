import links from "./knowledge-links.json";

/**
 * Where a Bazi citation can be read inside the knowledge centre.
 *
 * The rule base and the classic cases cite a page by the URL it was taken from, and the knowledge centre keeps the
 * same pages under their own ids. `knowledge-links.json` pairs the two, so a citation opens the page in the centre
 * when the centre holds it and keeps its original link when it does not. tests/bazi-knowledge-links.test.ts rebuilds
 * the pairs from the corpus, so a stale entry fails the suite.
 */
const SOURCE_IDS = links as Record<string, string>;

export function knowledgeSourceHref(kbUrl: string | null | undefined): string | null {
  const id = kbUrl ? SOURCE_IDS[kbUrl] : undefined;
  return id ? `/knowledge/source/${encodeURIComponent(id)}` : null;
}

/** Terms the knowledge centre explains (graph node or classical passages). Ten-god groups point at their best-attested member. */
export const BAZI_TERMS = {
  dayMaster: "日主",
  group: { companion: "比肩", output: "食神", wealth: "正财", officer: "正官", resource: "正印" },
} as const;

export function knowledgeTermHref(term: string): string {
  return `/knowledge/term/${encodeURIComponent(term)}`;
}
