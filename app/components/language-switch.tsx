"use client";

import { useI18n, type Locale } from "@/lib/i18n";

const OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: "zh", label: "中文" },
  { value: "en", label: "EN" },
];

export default function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="language-switch" role="group" aria-label={t("界面语言")}>
      {OPTIONS.map((option) => (
        <button
          type="button"
          key={option.value}
          className={locale === option.value ? "active" : ""}
          aria-pressed={locale === option.value}
          title={option.value === "en" ? t("切换到英文") : t("切换到中文")}
          onClick={() => setLocale(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
