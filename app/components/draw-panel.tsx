"use client";

import { Coins, House, Leaf, Link2, Mountain, Sailboat, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import CollectionButton from "@/app/components/collection-button";
import type { ApiEnvelope } from "@/lib/contracts/api";
import { getGuanyinStick } from "@/lib/guanyin/library";
import { getLocalizedGuanyinStick } from "@/lib/guanyin/translation";
import { type DrawRecord, type GuanyinDrawResult, type GuanyinReasoningStatement, type QuestionDomain } from "@/lib/guanyin/types";
import { useI18n } from "@/lib/i18n";
import { randomId } from "@/lib/crypto/random-id";

const domainOptions: ReadonlyArray<{ value: QuestionDomain; label: string }> = [
  { value: "career", label: "事业" },
  { value: "marriage", label: "姻缘" },
  { value: "wealth", label: "财运" },
  { value: "health", label: "健康" },
  { value: "family", label: "家庭" },
  { value: "travel", label: "出行" },
];
const DRAW_TRANSITION_MS = 3000;
const domainIcons: Readonly<Record<QuestionDomain, LucideIcon>> = {
  career: Mountain,
  marriage: Link2,
  wealth: Coins,
  health: Leaf,
  family: House,
  travel: Sailboat,
};

function DomainIcon({ domain }: { domain: QuestionDomain }) {
  const Icon = domainIcons[domain];
  return <span className="domain-glyph" aria-hidden="true"><Icon className="domain-icon" strokeWidth={1.45} /></span>;
}

function DrawAnimation({ stickNumber }: { stickNumber: number }) {
  const { t } = useI18n();
  return <div className="draw-animation" role="status" aria-live="polite">
    <div className="fortune-aura" aria-hidden="true" />
    <div className="fortune-tube" aria-hidden="true">
      <i className="tube-rim" />
      <div className="fortune-sticks">
        {[0, 1, 2, 3, 4, 5, 6].map((index) => <i className={index === 3 ? "fortune-stick chosen-stick" : "fortune-stick"} key={index}>
          {index === 3 && <b>{t("第 {number} 签", { number: stickNumber }, "Lot {number}")}</b>}
        </i>)}
      </div>
      <i className="tube-body"><span>{t("观音灵签")}</span></i>
    </div>
    <div className="draw-phase-copy"><span>{t("静置")}</span><span>{t("摇签")}</span><span>{t("出签")}</span><span>{t("显号")}</span></div>
  </div>;
}

export default function DrawPanel() {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [domain, setDomain] = useState<QuestionDomain | null>(null);
  const [record, setRecord] = useState<DrawRecord | null>(null);
  const [pendingRecord, setPendingRecord] = useState<DrawRecord | null>(null);
  const [notice, setNotice] = useState("");
  const isDrawing = pendingRecord !== null;

  const reset = () => {
    setQuestion("");
    setDomain(null);
    setRecord(null);
    setPendingRecord(null);
    setNotice("");
  };
  const close = () => {
    reset();
    setIsOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const startDraw = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !domain) { setNotice("请先写下所问之事，并选择一个问题领域。"); return; }
    if (isDrawing) return;
    setNotice("");
    try {
      const response = await fetch("/api/guanyin-lot/draw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: trimmedQuestion, domain, locale }) });
      const payload = await response.json() as ApiEnvelope<GuanyinDrawResult>;
      if (!response.ok || !payload.result?.stick?.id) throw new Error(payload.error?.message ?? "抽签服务暂不可用。");
      const nextRecord: DrawRecord = { drawId: payload.session_id ?? randomId(), question: trimmedQuestion, domain, stickNumber: payload.result.stick.id, drawnAt: payload.result.drawn_at, oracleVersion: "0.1.0", randomMethod: "server-crypto-random-int", reasoning: payload.result.reasoning, evidenceIntegration: payload.result.evidence_integration, llmGeneration: payload.result.llm_generation };
      setPendingRecord(nextRecord);
      void fetchExplanation(nextRecord, locale);
      window.setTimeout(() => setPendingRecord((current) => {
        if (current?.drawId === nextRecord.drawId) setRecord(current);
        return current?.drawId === nextRecord.drawId ? null : current;
      }), DRAW_TRANSITION_MS);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "抽签服务暂不可用。");
    }
  };

  const fetchExplanation = async (draw: DrawRecord, outputLocale: "zh" | "en") => {
    try {
      const response = await fetch("/api/guanyin-lot/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: draw.question, domain: draw.domain, signId: draw.stickNumber, locale: outputLocale }) });
      const payload = await response.json() as ApiEnvelope<DrawRecord["llmGeneration"]>;
      if (!response.ok || !payload.result) throw new Error("现代解释暂未生成。");
      const update = (current: DrawRecord | null) => current?.drawId === draw.drawId ? { ...current, llmGeneration: payload.result! } : current;
      setPendingRecord(update);
      setRecord(update);
    } catch {
      const failed = { ...draw.llmGeneration, status: "failed" as const, warning: "现代解释暂未生成，基础解读仍然有效。" };
      const update = (current: DrawRecord | null) => current?.drawId === draw.drawId ? { ...current, llmGeneration: failed } : current;
      setPendingRecord(update);
      setRecord(update);
    }
  };

  return <>
    <button className="oracle-launcher" type="button" onClick={() => setIsOpen(true)} aria-haspopup="dialog">
      <strong>{t("开始抽签")}</strong><span aria-hidden="true">→</span>
    </button>
    {isOpen && <div className="oracle-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="oracle-modal" role="dialog" aria-modal="true" aria-labelledby="oracle-dialog-title">
        <button className="modal-close" type="button" aria-label={t("关闭抽签窗口")} onClick={close}>×</button>
        {record ? <Result record={record} onReset={reset} /> : <div className="draw-card">
          <p className="eyebrow">{t("观音灵签 · 百签")}</p><h2 id="oracle-dialog-title">{t("一签问一事")}</h2>
          {!isDrawing && <>
            <label htmlFor="question">{t("所问之事")}</label>
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t("写下此刻最想问的一件事")} rows={3} />
            <p className="question-guidance">{t("宜一事一问，写下此刻真正想确认的事情。")}</p>
            <fieldset><legend>{t("请选择领域")}</legend><div className="domain-grid">{domainOptions.map((option) => <label className="domain-option" key={option.value}>
              <input type="radio" name="domain" value={option.value} checked={domain === option.value} onChange={() => setDomain(option.value)} /><span className="domain-plaque"><DomainIcon domain={option.value} /><em>{t(option.label)}</em></span>
            </label>)}</div></fieldset>
            {notice && <p className="notice" role="alert">{notice}</p>}
            <button className="primary-button" type="button" onClick={startDraw}>{t("开始抽签")}</button>
            <p className="draw-disclaimer">{t("一事一问，结果仅供传统文化学习与自我整理。")}</p>
          </>}
          {pendingRecord && <DrawAnimation stickNumber={pendingRecord.stickNumber} />}
        </div>}
      </section>
    </div>}
  </>;
}

function Result({ record, onReset }: { record: DrawRecord; onReset: () => void }) {
  const { t, locale } = useI18n();
  const stick = getGuanyinStick(record.stickNumber);
  const displayStick = getLocalizedGuanyinStick(record.stickNumber, locale);
  const domainLabel = domainOptions.find((option) => option.value === record.domain)?.label;
  return <div className="result-card" aria-live="polite">
    <div className="result-topline"><div><p className="eyebrow">{t("你所问的事")}</p><p className="result-question">{record.question}</p></div><CollectionButton
      action="interpretation"
      compact
      evidence={[stick.traditional.jieyue, stick.traditional.xianji, stick.traditional.topics[record.domain], stick.traditional.diangu]}
      itemType="sign_record"
      key={record.drawId}
      label="收藏签文"
      module="guanyin"
      sourceId={`guanyin-record:${record.drawId}`}
      step="reading"
      summary={`问：${record.question}；第 ${stick.id} 签「${stick.title}」${stick.level}。${stick.traditional.jieyue}`}
      tags={["观音灵签", record.domain, `第${stick.id}签`]}
      title={`观音灵签 · 第${stick.id}签 ${stick.title}`}
      snapshot={{ record, stick }}
    /></div><div className="result-heading"><p>{t("第 {number} 签", { number: stick.id }, "Lot {number}")}</p><span>{displayStick.level}</span></div><h2 id="oracle-dialog-title">{displayStick.title}</h2>
    <div className="poem" aria-label={t("签诗")}>{displayStick.poem.map((line) => <p key={line}>{line}</p>)}</div>
    <UserFacingResult record={record} />
    <details className="traditional-details"><summary>{t("查看签文原解与典故")}</summary><dl className="interpretations"><div><dt>{t("传统解曰")}</dt><dd>{displayStick.traditional.jieyue}</dd></div><div><dt>{t("传统仙机")}</dt><dd>{displayStick.traditional.xianji}</dd></div><div><dt>{t(domainLabel ?? "事项")}</dt><dd>{displayStick.traditional.topics[record.domain]}</dd></div><div><dt>{locale === "en" ? "Traditional story (abridged)" : t("传统典故")}</dt><dd>{displayStick.traditional.diangu}</dd></div></dl></details>
    {locale === "en" && <details className="traditional-details"><summary>View the Chinese source</summary><div lang="zh-CN"><h3>{stick.title} · {stick.level}</h3><div className="poem">{stick.poem.map((line, index) => <p key={index}>{line}</p>)}</div><dl className="interpretations"><div><dt>传统解曰</dt><dd>{stick.traditional.jieyue}</dd></div><div><dt>传统仙机</dt><dd>{stick.traditional.xianji}</dd></div><div><dt>{domainLabel}事项</dt><dd>{stick.traditional.topics[record.domain]}</dd></div><div><dt>传统典故</dt><dd>{stick.traditional.diangu}</dd></div></dl></div></details>}
    <ReasoningEvidence record={record} />
    <ReadingBoundaries record={record} />
    <div className="oracle-result-actions"><button className="secondary-button" type="button" onClick={onReset}>{t("重新问事")}</button></div>
  </div>;
}

function UserFacingResult({ record }: { record: DrawRecord }) {
  const { t } = useI18n();
  const { reasoning, llmGeneration: generation } = record;
  const [isTakingLonger, setIsTakingLonger] = useState(false);
  useEffect(() => {
    if (generation.status !== "pending") return;
    const timer = window.setTimeout(() => setIsTakingLonger(true), 60_000);
    return () => window.clearTimeout(timer);
  }, [generation.status]);
  const explanation = generation.explanation;
  const isPersonalized = generation.status === "generated" && explanation !== null;
  const directAnswer = explanation?.directAnswer.text ?? reasoning.primarySafetyAnswer?.text ?? reasoning.coreJudgment?.text ?? "这支签目前只适合结合原文理解，不宜据此直接作出现实决定。";
  const oracleContext = explanation?.oracleContext?.text ?? (reasoning.primarySafetyAnswer ? reasoning.coreJudgment?.text : undefined);
  const actions = explanation?.actions.map((item) => item.text) ?? [...reasoning.practicalGuidance.map((item) => item.text), ...reasoning.actions.map((item) => item.text)].slice(0, 3);
  const risks = explanation?.risks.map((item) => item.text) ?? reasoning.risks.map((item) => item.text);
  const safetyGuidance = explanation?.safetyGuidance.map((item) => item.text) ?? [];
  return <>{generation.status === "pending" && <div className="explanation-progress explanation-progress-above" role="status"><div className="explanation-stages" aria-label={t("个性化解读进度")}><p className="is-complete"><i aria-hidden="true">✓</i>{t("已完成抽签")}</p><p className="is-complete"><i aria-hidden="true">✓</i>{t("已整理签文基础含义")}</p><p className="is-active"><i aria-hidden="true" />{t("正在结合你的问题生成解释")}</p><p className="is-waiting"><i aria-hidden="true" />{t("完成后自动检查解释依据")}</p></div>{isTakingLonger && <p className="explanation-delay-note">{t("个性化解释通常需要约 1 分钟，你可以先阅读签文，完成后会自动显示。")}</p>}</div>}
  <section className={`user-result ${isPersonalized ? "is-personalized" : "is-basic"}`} aria-labelledby="user-result-title">
    <div className="user-result-intro"><p className="eyebrow">{t("结合你所问之事")}</p><h3 id="user-result-title">{t(isPersonalized ? "个性化解读" : "基础解读")}</h3>{!isPersonalized && generation.status === "pending" && <small>{t("个性化解读生成期间，你可以先阅读以下基础内容。")}</small>}</div>
    <div className="user-result-answer"><p>{directAnswer}</p></div>
    <div className="user-result-body">
      {oracleContext && <section className="user-result-section oracle-context-card"><h4>{t("签文依据与问题解读")}</h4><p>{oracleContext}</p></section>}
      {explanation?.conditions.length ? <section className="user-result-section conditions-card"><h4>{t("需要满足的现实条件")}</h4><ul>{explanation.conditions.map((item) => <li key={item.text}>{item.text}</li>)}</ul></section> : null}
      {actions.length > 0 && <section className="user-result-section action-list actions-card"><h4>{t("接下来可以怎么做")}</h4><ol>{actions.map((item) => <li key={item}>{item}</li>)}</ol></section>}
      {risks.length > 0 && <section className="user-result-section risks-card"><h4>{t("需要留意")}</h4><ul>{risks.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      {safetyGuidance.length > 0 && <section className="user-result-section safety-guidance-card"><h4>{t("安全提醒", undefined, "Safety reminder")}</h4><ul>{safetyGuidance.map((item) => <li key={item}>{item}</li>)}</ul></section>}
    </div>
    {generation.status === "insufficient_evidence" && !explanation && <p className="explanation-fallback">{t("现有资料不足，只呈现可核实的基础解读。")}</p>}
    {generation.status !== "pending" && generation.status !== "generated" && generation.status !== "insufficient_evidence" && generation.warning && <p className="explanation-fallback" role="alert">{t(generation.warning)}</p>}
  </section></>;
}

function ReadingBoundaries({ record }: { record: DrawRecord }) {
  const { t } = useI18n();
  const explanation = record.llmGeneration.explanation;
  const uncertainties = explanation?.uncertainties ?? record.reasoning.uncertainties;
  return <details className="uncertainty-details reading-boundaries-final"><summary>{t("阅读边界与不确定性")}</summary><ul>{uncertainties.map((item) => <li key={item}>{item}</li>)}</ul><p>{explanation?.disclaimer ?? "签文用于传统文化学习与文本理解，不替代现实中的专业判断。"}</p></details>;
}

function ReasoningList({ title, items }: { title: string; items: readonly GuanyinReasoningStatement[] }) {
  if (items.length === 0) return null;
  return <section className="reasoning-section"><h4>{title}</h4><ul>{items.map((item) => <li key={`${item.tagIds.join("-")}-${item.sourceIds.join("-")}`}>{item.text}</li>)}</ul></section>;
}

function ReasoningEvidence({ record }: { record: DrawRecord }) {
  const { t } = useI18n();
  const { reasoning } = record;
  if (reasoning.coverage === "unavailable") return null;
  const tagLabels = new Map(reasoning.evidence.map((item) => [item.tag.id, item.tag.label]));
  const graphEvidence = record.evidenceIntegration.evidence.filter((item) => item.type === "traditional_context");
  return <details className="reasoning-evidence user-evidence"><summary>{t("查看解读依据")}</summary>
    <ReasoningList title={t("发展趋势")} items={reasoning.trends} /><ReasoningList title={t("时机信息")} items={reasoning.timing} /><ReasoningList title={t("象征说明")} items={reasoning.symbols} />
    <div className="evidence-keyword-grid">{reasoning.evidence.map((item) => <blockquote key={`${item.tag.id}-${item.sourceId}`}><strong>{item.tag.label}</strong><p>{item.evidenceText}</p></blockquote>)}</div>
    {graphEvidence.length > 0 && <section className="graph-evidence-section"><h4>{t("图谱补充依据")}</h4><div className="evidence-keyword-grid graph-evidence-grid">{graphEvidence.map((item) => {
      const labels = item.tagIds.map((id) => tagLabels.get(id)).filter((label): label is string => Boolean(label));
      return <blockquote key={item.sourceId}><strong>{labels.join(" · ") || t("传统资料")}</strong><p>{item.text}</p><small className="evidence-source">{t("出处")}：{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</small></blockquote>;
    })}</div></section>}
  </details>;
}
