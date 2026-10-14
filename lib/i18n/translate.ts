import { EN } from "./dictionary";
import { fillTemplate, type Locale } from "./locale";

export type Translate = (
  zh: string,
  params?: Record<string, string | number>,
  en?: string,
) => string;

/**
 * Translate a piece of interface copy.
 *
 * The Chinese string is the key, so a page reads as it is written and a missing
 * translation falls back to the original rather than to a blank label. Pass
 * `en` for copy that appears once, and `params` for the parts that vary, e.g.
 * `t("找到 {count} 条", {count: 3})`.
 *
 * Kept apart from the React provider so server components can render a title
 * without pulling a client reference into the server graph.
 */
export function translate(
  locale: Locale,
  zh: string,
  params?: Record<string, string | number>,
  en?: string,
): string {
  if (locale === "zh") return fillTemplate(zh, params);
  const template = en ?? EN[zh] ?? zh;
  return fillTemplate(template, params);
}
