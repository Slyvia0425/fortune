/** The two presentation languages. Nothing here touches stored data. */
export type Locale = "zh" | "en";

export const LOCALE_COOKIE = "fortune_locale";
export const DEFAULT_LOCALE: Locale = "zh";

export function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "en";
}

export function htmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

/**
 * Fill `{name}` placeholders in a template.
 *
 * Values that arrive as numbers keep the digits the reader expects, so a count
 * of records renders the same in both languages.
 */
export function fillTemplate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
