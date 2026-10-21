"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

const MODULES = [
  {
    href: "/bazi",
    index: "壹",
    mobileIndex: "八",
    title: "八字命盘",
    mobileTitle: "排八字",
    text: "排四柱，观五行、十神与岁运。",
    meta: "四柱有序 · 推演可查",
  },
  {
    href: "/divination",
    index: "贰",
    mobileIndex: "易",
    title: "智能占卜",
    mobileTitle: "起一卦",
    text: "起一卦，察本卦、互卦与变卦。",
    meta: "卦象分明 · 变爻可考",
  },
  {
    href: "/guanyin",
    index: "叁",
    mobileIndex: "签",
    title: "观音灵签",
    mobileTitle: "求一签",
    text: "求一签，读签诗、原解与典故。",
    meta: "签诗有本 · 典故有源",
  },
  {
    href: "/knowledge",
    index: "肆",
    mobileIndex: "典",
    title: "典籍求索",
    mobileTitle: "查典籍",
    text: "查术语，也查古籍原文与出处。",
    meta: "循名索典 · 据文求义",
  },
];

const STATS = [
  { value: "原典", label: "分层整理，出处可循" },
  { value: "灵签", label: "签诗典故，原貌呈现" },
  { value: "互证", label: "规则与原文，相互印证" },
];

export default function Home() {
  const { t } = useI18n();
  return (
    <main className="home-page">
      <section className="hero page-shell">
        <div className="hero-copy">
          <p className="kicker">{t("FORTUNE TELLER MASTER · 东方术数知识系统")}</p>
          <h1>
            {t("问古知今，")}
            <br />
            <em>{t("见理而行")}</em>
          </h1>
          <p className="hero-lead">
            {t(
              "以规则完成推演，以古籍提供依据，以清晰的现代语言帮助你理解传统文化中的象、数与理。",
            )}
          </p>
          <nav className="mobile-home-actions" aria-label={t("首页功能入口")}>
            <p>
              <strong>{t("你想从哪里开始？")}</strong>
              <span>{t("选择一项即可进入")}</span>
            </p>
            <div>
              {MODULES.map((item) => (
                <Link href={item.href} key={item.href}>
                  <b>{item.mobileIndex}</b>
                  <span>
                    <strong>{t(item.mobileTitle)}</strong>
                    <small>{t(item.title)}</small>
                  </span>
                  <i>›</i>
                </Link>
              ))}
            </div>
            <Link className="mobile-library-entry" href="/library">
              <b>藏</b>
              <span>
                <strong>{t("我的藏书")}</strong>
                <small>{t("收藏、笔记与个人资料")}</small>
              </span>
              <i>›</i>
            </Link>
          </nav>
          <div className="hero-actions">
            <Link className="button button-primary" href="/knowledge?tab=library">
              {t("入藏书阁")}
            </Link>
            <Link className="text-link" href="/library">
              {t("打开我的书斋")} <span>→</span>
            </Link>
          </div>
        </div>
        <div className="hero-orbit" aria-label={t("系统包含八字、易卦、灵签和典籍四类知识")}>
          <span className="orbit-ring orbit-one" />
          <span className="orbit-ring orbit-two" />
          <Link className="orbit-center" href="/knowledge?tab=graph" title={t("进入概念图谱")}>
            <span>象</span>
            <small>{t("理 · 数 · 识")}</small>
          </Link>
          <span className="orbit-label label-a">{t("八字")}<small>BAZI</small></span>
          <span className="orbit-label label-b">{t("易卦")}<small>I CHING</small></span>
          <span className="orbit-label label-c">{t("灵签")}<small>LOTS</small></span>
          <span className="orbit-label label-d">{t("典籍")}<small>TEXTS</small></span>
        </div>
      </section>
      <section className="page-shell section-block home-module-section">
        <div className="section-heading">
          <div>
            <p className="kicker">{t("四境合一")}</p>
            <h2>{t("从推演到求证的完整路径")}</h2>
          </div>
          <p>
            {t(
              "四条路径，各有原文与来处。",
            )}
          </p>
        </div>
        <div className="module-grid">
          {MODULES.map((item) => (
            <Link className="module-card" href={item.href} key={item.href}>
              <span className="module-index">{t(item.index)}</span>
              <div>
                <h3>{t(item.title)}</h3>
                <p>{t(item.text)}</p>
                <small>{t(item.meta)}</small>
              </div>
              <span className="card-arrow">↗</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="ink-section">
        <div className="page-shell evidence-grid">
          <div>
            <p className="kicker light">{t("循文溯源")}</p>
            <h2>
              {t("每一层解读，")}
              <br />
              {t("皆有原典可循。")}
            </h2>
          </div>
          <div className="evidence-stats">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <strong>{t(stat.value)}</strong>
                <span>{t(stat.label)}</span>
              </div>
            ))}
          </div>
          <p className="evidence-note">
            {t(
              "推演有据，解读有源；资料不足，直言其限。",
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
