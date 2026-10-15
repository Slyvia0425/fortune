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
    text: "录入出生信息，查看四柱、五行、十神与时运结构。",
    meta: "规则计算 · 结构化输出",
  },
  {
    href: "/divination",
    index: "贰",
    mobileIndex: "易",
    title: "智能占卜",
    mobileTitle: "起一卦",
    text: "以数字或随机方式起卦，呈现本卦、互卦与变卦。",
    meta: "六爻演算 · 可复核",
  },
  {
    href: "/guanyin",
    index: "叁",
    mobileIndex: "签",
    title: "观音灵签",
    mobileTitle: "求一签",
    text: "从百签数据库中抽取一签，分层阅读签诗与典故。",
    meta: "百签签库 · 原文保真",
  },
  {
    href: "/knowledge",
    index: "肆",
    mobileIndex: "典",
    title: "典籍求索",
    mobileTitle: "查典籍",
    text: "在古籍、注解与现代资料中检索术语和原文依据。",
    meta: "764 篇资料 · 来源可溯",
  },
];

const STATS = [
  { value: "764", label: "结构化知识页面" },
  { value: "100", label: "观音灵签资料" },
  { value: "4", label: "核心功能模块" },
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
            <Link className="button button-primary" href="/guanyin">
              {t("静心求一签")}
            </Link>
            <Link className="text-link" href="/knowledge">
              {t("先读一卷典籍")} <span>→</span>
            </Link>
          </div>
        </div>
        <div className="hero-orbit" aria-label={t("系统包含八字、易卦、灵签和典籍四类知识")}>
          <span className="orbit-ring orbit-one" />
          <span className="orbit-ring orbit-two" />
          <div className="orbit-center">
            <span>象</span>
            <small>{t("理 · 数 · 识")}</small>
          </div>
          <span className="orbit-label label-a">{t("八字")}</span>
          <span className="orbit-label label-b">{t("易卦")}</span>
          <span className="orbit-label label-c">{t("灵签")}</span>
          <span className="orbit-label label-d">{t("典籍")}</span>
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
              "所有传统原文、规则结果与系统解释均分层呈现。重要决定，请始终结合现实信息与专业意见。",
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
            <p className="kicker light">{t("知识有出处")}</p>
            <h2>
              {t("每一次解释，")}
              <br />
              {t("都能回到原文。")}
            </h2>
          </div>
          <div className="evidence-stats">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{t(stat.label)}</span>
              </div>
            ))}
          </div>
          <p className="evidence-note">
            {t(
              "系统把规则计算、传统资料与辅助解释明确区分。资料不足时会说明不确定性，不用生成内容冒充古籍原文。",
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
