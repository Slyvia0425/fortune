"use client";

import { useEffect, useState } from "react";

import CollectionButton from "@/app/components/collection-button";
import { getGuanyinStick } from "@/lib/guanyin/library";
import { type DrawRecord, type QuestionDomain } from "@/lib/guanyin/types";

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
      const payload = await response.json();
      if (!response.ok || !payload.result?.stick?.id) throw new Error(payload.error?.message ?? "抽签服务暂不可用。");
      const nextRecord: DrawRecord = { drawId: payload.session_id ?? crypto.randomUUID(), question: trimmedQuestion, domain, stickNumber: payload.result.stick.id, drawnAt: payload.result.drawn_at, oracleVersion: "0.1.0", randomMethod: "server-crypto-random-int" };
      setPendingRecord(nextRecord);
      window.setTimeout(() => { setRecord(nextRecord); setPendingRecord(null); }, DRAW_TRANSITION_MS);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "抽签服务暂不可用。");
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
            {question.trim() && domain ? (
              <CollectionButton
                action="question"
                compact
                itemType="sign_question"
                label="收藏所问"
                module="guanyin"
                sourceId={`guanyin-question:${domain}:${question.trim().slice(0, 80)}`}
                step="question"
                summary={`观音灵签问事（${domainOptions.find((option) => option.value === domain)?.label}）：${question.trim()}`}
                tags={["观音灵签", domain]}
                title="观音灵签问事记录"
                snapshot={{ question: question.trim(), domain }}
              />
            ) : null}
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
    <div className="question-echo">
      <span>所问之事</span>
      <p>{record.question}</p>
      <small>{domainLabel}</small>
    </div>
    <div className="result-heading"><p>第 {stick.id} 签</p><span>{stick.level}</span></div><h2 id="oracle-dialog-title">{stick.title}</h2>
    <div className="poem" aria-label="签诗">{stick.poem.map((line) => <p key={line}>{line}</p>)}</div>
    <dl className="interpretations"><div><dt>传统解曰</dt><dd>{stick.traditional.jieyue}</dd></div><div><dt>传统仙机</dt><dd>{stick.traditional.xianji}</dd></div><div><dt>{domainLabel}事项</dt><dd>{stick.traditional.topics[record.domain]}</dd></div><div><dt>传统典故</dt><dd>{stick.traditional.diangu}</dd></div></dl>
    <CollectionButton
      action="interpretation"
      autoRecord
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
    />
    <button className="secondary-button" type="button" onClick={onReset}>重新问事</button>
  </div>;
}
