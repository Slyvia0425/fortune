"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import AuthControls from "./auth-controls";
import LanguageSwitch from "./language-switch";

const NAV = [
  { href: "/bazi", label: "八字" },
  { href: "/divination", label: "易卦" },
  { href: "/guanyin", label: "灵签" },
  { href: "/knowledge", label: "典籍" },
  { href: "/library", label: "智库" },
];

export default function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="site-header">
      <div className="nav-shell">
        <Link className="brand" href="/" aria-label={t("返回首页")} title={t("返回首页")}>
          <span className="brand-seal">知</span>
          <span className="brand-copy">
            <b>{t("知命")}</b>
            <small>FORTUNE MASTER</small>
          </span>
          <span className="brand-home-cue" aria-hidden="true">
            <span>首页</span>
            <small>HOME</small>
            <i>→</i>
          </span>
        </Link>
        <nav aria-label={t("主导航")}>
          {NAV.map((item) => (
            <Link href={item.href} key={item.href}>
              {t(item.label)}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <LanguageSwitch />
          <AuthControls />
        </div>
      </div>
    </header>
  );
}
