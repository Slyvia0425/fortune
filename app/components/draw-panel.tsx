"use client";

import { useEffect, useState } from "react";

import type { ApiEnvelope } from "@/lib/contracts/api";
import { getGuanyinStick } from "@/lib/guanyin/library";
import { type DrawRecord, type GuanyinDrawResult, type GuanyinReasoningStatement, type QuestionDomain } from "@/lib/guanyin/types";

const domainOptions: ReadonlyArray<{ value: QuestionDomain; label: string }> = [
  { value: "career", label: "事业" },
  { value: "marriage", label: "姻缘" },
  { value: "wealth", label: "财运" },
  { value: "health", label: "健康" },
  { value: "family", label: "家庭" },
  { value: "travel", label: "出行" },
];
const DRAW_TRANSITION_MS = 3000;

function DrawAnimation({ stickNumber }: { stickNumber: number }) {
  return <div className="draw-animation" role="status" aria-live="polite">
    <div className="fortune-tube" aria-hidden="true">
      <i className="tube-rim" />
      <div className="fortune-sticks">
        {[0, 1, 2, 3, 4, 5, 6].map((index) => <i className={index === 3 ? "fortune-stick chosen-stick" : "fortune-stick"} key={index}>
          {index === 3 && <b>第 {stickNumber} 签</b>}
        </i>)}
      </div>
      <i className="tube-body" />
    </div>
    <p>签条轻晃，静候一签停驻</p>
  </div>;
}

export default function DrawPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [domain, setDomain] = useState<QuestionDomain | null>(null);
  const [record, setRecord] = useState<DrawRecord | null>(null);
  const [pendingRecord, setPendingRecord] = useState<DrawRecord | null>(null);
  const [notice, setNotice] = useState("");
  const isDrawing = pendingRecord !== null;

  const reset = () => {
    if (isDrawing) return;
    setQuestion("");
    setDomain(null);
    setRecord(null);
    setNotice("");
  };
  const close = () => {
    if (isDrawing) return;
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
      const response = await fetch("/api/guanyin-lot/draw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: trimmedQuestion, domain }) });
      const payload = await response.json() as ApiEnvelope<GuanyinDrawResult>;
      if (!response.ok || !payload.result?.stick?.id) throw new Error(payload.error?.message ?? "抽签服务暂不可用。");
      const nextRecord: DrawRecord = { drawId: payload.session_id ?? crypto.randomUUID(), question: trimmedQuestion, domain, stickNumber: payload.result.stick.id, drawnAt: payload.result.drawn_at, oracleVersion: "0.1.0", randomMethod: "server-crypto-random-int", reasoning: payload.result.reasoning, evidenceIntegration: payload.result.evidence_integration, llmGeneration: payload.result.llm_generation };
      setPendingRecord(nextRecord);
      void fetchExplanation(nextRecord);
      window.setTimeout(() => setPendingRecord((current) => {
        if (current?.drawId === nextRecord.drawId) setRecord(current);
        return current?.drawId === nextRecord.drawId ? null : current;
      }), DRAW_TRANSITION_MS);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "抽签服务暂不可用。");
    }
  };

  const fetchExplanation = async (draw: DrawRecord) => {
    try {
      const response = await fetch("/api/guanyin-lot/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: draw.question, domain: draw.domain, signId: draw.stickNumber }) });
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
      <span>观音</span><strong>灵签</strong>
    </button>
    {isOpen && <div className="oracle-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="oracle-modal" role="dialog" aria-modal="true" aria-labelledby="oracle-dialog-title">
        <button className="modal-close" type="button" aria-label="关闭抽签窗口" onClick={close} disabled={isDrawing}>×</button>
        {record ? <Result record={record} onReset={reset} /> : <div className="draw-card">
          <p className="eyebrow">观音灵签 · 百签</p><h2 id="oracle-dialog-title">一签问一事</h2>
          {!isDrawing && <>
            <label htmlFor="question">所问之事</label>
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="写下此刻最想问的一件事" rows={3} />
            <fieldset><legend>请选择领域</legend><div className="domain-grid">{domainOptions.map((option) => <label className="domain-option" key={option.value}>
              <input type="radio" name="domain" value={option.value} checked={domain === option.value} onChange={() => setDomain(option.value)} /><span>{option.label}</span>
            </label>)}</div></fieldset>
            {notice && <p className="notice" role="alert">{notice}</p>}
            <button className="primary-button" type="button" onClick={startDraw}>开始抽签</button>
          </>}
          {pendingRecord && <DrawAnimation stickNumber={pendingRecord.stickNumber} />}
        </div>}
      </section>
    </div>}
  </>;
}

function Result({ record, onReset }: { record: DrawRecord; onReset: () => void }) {
  const stick = getGuanyinStick(record.stickNumber);
  const domainLabel = domainOptions.find((option) => option.value === record.domain)?.label;
  return <div className="result-card" aria-live="polite">
    <p className="eyebrow">你所问的事</p><p className="result-question">{record.question}</p><div className="result-heading"><p>第 {stick.id} 签</p><span>{stick.level}</span></div><h2 id="oracle-dialog-title">{stick.title}</h2>
    <div className="poem" aria-label="签诗">{stick.poem.map((line) => <p key={line}>{line}</p>)}</div>
    <UserFacingResult record={record} />
    <details className="traditional-details"><summary>查看签文原解与典故</summary><dl className="interpretations"><div><dt>传统解曰</dt><dd>{stick.traditional.jieyue}</dd></div><div><dt>传统仙机</dt><dd>{stick.traditional.xianji}</dd></div><div><dt>{domainLabel}事项</dt><dd>{stick.traditional.topics[record.domain]}</dd></div><div><dt>传统典故</dt><dd>{stick.traditional.diangu}</dd></div></dl></details>
    <ReasoningEvidence reasoning={record.reasoning} />
    <button className="secondary-button" type="button" onClick={onReset}>重新问事</button>
  </div>;
}

function UserFacingResult({ record }: { record: DrawRecord }) {
  const { reasoning, llmGeneration: generation } = record;
  const explanation = generation.explanation;
  const directAnswer = explanation?.directAnswer.text ?? reasoning.primarySafetyAnswer?.text ?? reasoning.coreJudgment?.text ?? "这支签目前只适合结合原文理解，不宜据此直接作出现实决定。";
  const oracleContext = explanation?.oracleContext?.text ?? (reasoning.primarySafetyAnswer ? reasoning.coreJudgment?.text : undefined);
  const actions = explanation?.actions.map((item) => item.text) ?? [...reasoning.practicalGuidance.map((item) => item.text), ...reasoning.actions.map((item) => item.text)].slice(0, 3);
  const risks = explanation?.risks.map((item) => item.text) ?? reasoning.risks.map((item) => item.text);
  const uncertainties = explanation?.uncertainties ?? reasoning.uncertainties;
  return <section className="user-result" aria-labelledby="user-result-title">
    <p className="eyebrow">结合你所问之事</p><h3 id="user-result-title">先看结论</h3><div className="user-result-answer"><p>{directAnswer}</p></div>
    {oracleContext && <section className="user-result-section"><h4>这支签的倾向</h4><p>{oracleContext}</p></section>}
    {explanation?.conditions.length ? <section className="user-result-section"><h4>需要满足的现实条件</h4><ul>{explanation.conditions.map((item) => <li key={item.text}>{item.text}</li>)}</ul></section> : null}
    {actions.length > 0 && <section className="user-result-section action-list"><h4>接下来可以怎么做</h4><ol>{actions.map((item) => <li key={item}>{item}</li>)}</ol></section>}
    {risks.length > 0 && <section className="user-result-section"><h4>需要留意</h4><ul>{risks.map((item) => <li key={item}>{item}</li>)}</ul></section>}
    {generation.status === "pending" && <div className="explanation-progress" role="status"><span aria-hidden="true" /><div><strong>正在整理更贴合问题的现代解释</strong><p>你可以先阅读以上结果，完成后会自动补充，不必停留等待。</p></div></div>}
    {generation.status !== "pending" && !explanation && <p className="explanation-fallback">{generation.warning ?? "扩展解释暂不可用，以上基础解读仍然有效。"}</p>}
    <details className="uncertainty-details"><summary>阅读边界与不确定性</summary><ul>{uncertainties.map((item) => <li key={item}>{item}</li>)}</ul><p>{explanation?.disclaimer ?? "签文用于传统文化学习与文本理解，不替代现实中的专业判断。"}</p></details>
  </section>;
}

function ReasoningList({ title, items }: { title: string; items: readonly GuanyinReasoningStatement[] }) {
  if (items.length === 0) return null;
  return <section className="reasoning-section"><h4>{title}</h4><ul>{items.map((item) => <li key={`${item.tagIds.join("-")}-${item.sourceIds.join("-")}`}>{item.text}</li>)}</ul></section>;
}

function ReasoningEvidence({ reasoning }: { reasoning: DrawRecord["reasoning"] }) {
  if (reasoning.coverage === "unavailable") return null;
  return <details className="reasoning-evidence user-evidence"><summary>查看解读依据</summary>
    <ReasoningList title="发展趋势" items={reasoning.trends} /><ReasoningList title="时机信息" items={reasoning.timing} /><ReasoningList title="象征说明" items={reasoning.symbols} />
    {reasoning.evidence.map((item) => <blockquote key={`${item.tag.id}-${item.sourceId}`}><strong>{item.tag.label}</strong><p>{item.evidenceText}</p></blockquote>)}
  </details>;
}
