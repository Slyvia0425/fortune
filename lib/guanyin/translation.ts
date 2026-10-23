import englishData from "../../sticks/guanyin.en.json";
import { getGuanyinStick, validateGuanyinLibrary } from "./library";
import type { GuanyinStick } from "./types";
import type { Locale } from "../i18n/locale";

export interface GuanyinTranslationCatalog {
  version: string;
  sourceVersion: "guanyin-100-v1";
  locale: "en";
  sourceSha256: string;
  translationMethod: string;
  translations: readonly GuanyinStick[];
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`观音签英译校验失败：${field} 必须是非空字符串。`);
  return value;
}

export function validateGuanyinTranslationCatalog(value: unknown): GuanyinTranslationCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("观音签英译校验失败：顶层必须是对象。");
  const input = value as Record<string, unknown>;
  if (input.locale !== "en") throw new Error("观音签英译校验失败：locale 必须是 en。");
  if (!Array.isArray(input.translations) || input.translations.length !== 100) throw new Error("观音签英译校验失败：必须完整包含 100 支签。");
  if (input.sourceVersion !== "guanyin-100-v1") throw new Error("观音签英译校验失败：中文底本版本不匹配。");
  const sourceSha256 = requireText(input.sourceSha256, "sourceSha256");
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error("观音签英译校验失败：中文底本指纹无效。");
  // Reuse source-library checks for IDs, four verse lines, and six domains.
  const translations = validateGuanyinLibrary(input.translations);
  for (const stick of translations) {
    if (/\p{Script=Han}/u.test(JSON.stringify(stick))) throw new Error(`观音签英译校验失败：第 ${stick.id} 签仍有未翻译的中文。`);
    Object.freeze(stick.poem);
    Object.freeze(stick.traditional.topics);
    Object.freeze(stick.traditional);
    Object.freeze(stick);
  }
  return Object.freeze({
    version: requireText(input.version, "version"), sourceVersion: input.sourceVersion,
    locale: "en", sourceSha256,
    translationMethod: requireText(input.translationMethod, "translationMethod"), translations,
  });
}

export const guanyinEnglishCatalog = validateGuanyinTranslationCatalog(englishData);
const englishById = new Map(guanyinEnglishCatalog.translations.map(stick => [stick.id, stick]));

/** Resolve presentation text for the existing draw; never draw or reason here. */
export function getLocalizedGuanyinStick(stickNumber: unknown, locale: Locale): GuanyinStick {
  const original = getGuanyinStick(stickNumber);
  if (locale === "zh") return original;
  const translated = englishById.get(original.id);
  if (!translated) throw new RangeError(`English translation missing for lot ${original.id}`);
  return translated;
}
