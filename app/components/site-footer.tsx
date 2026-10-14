"use client";

import { useI18n } from "@/lib/i18n";

export default function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <div className="page-shell">
        <div className="brand footer-brand">
          <span className="brand-seal">知</span>
          <span>
            <b>{t("知命")}</b>
            <small>FORTUNE MASTER</small>
          </span>
        </div>
        <p>{t("传统文化学习与知识探索工具。内容不构成医疗、法律或投资建议。")}</p>
        <p>{t("规则为骨，典籍为据，语言为桥。")}</p>
      </div>
    </footer>
  );
}
