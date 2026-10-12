"use client";

import { useEffect, useRef, useState } from "react";
import chatStyles from "./divination-chatbot.module.css";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { DivinationCastResult, DivinationChatMessage, DivinationChatReply, DivinationInterpretationResult, QuestionContext } from "@/lib/contracts/divination";
import HexagramEvolution from "./hexagram-evolution";
import InterpretationPanel from "./interpretation-panel";

const intro = "我是问卦助手。先告诉我你要问的一件事；我会简短确认时间范围和起卦数字，再为你推演卦象。";
const resultCacheKey = "fortune.divination.latest-result.v2";

export default function DivinationChatbot() {
  const [messages, setMessages] = useState<DivinationChatMessage[]>([{ role: "assistant", content: intro }]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<DivinationChatReply | null>(null);
  const [cast, setCast] = useState<DivinationCastResult | null>(null);
  const [questionContext, setQuestionContext] = useState<QuestionContext | null>(null);
  const sessionId = useRef<string | null>(null);
  const sequence = useRef(0);
  const [interpretation, setInterpretation] = useState<DivinationInterpretationResult | null>(null);
  const [restored, setRestored] = useState(false);
  const [interpretationPending, setInterpretationPending] = useState(false);
  const [interpretationError, setInterpretationError] = useState<string | null>(null);
  const interpretationRequest = useRef(0);

  async function loadInterpretation(activeCast: DivinationCastResult, context: QuestionContext | null | undefined, retry = false) {
    const request = ++interpretationRequest.current;
    setInterpretationPending(true); setInterpretationError(null);
    try {
      const response = await fetch("/api/divination/interpret", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chart_id: activeCast.chart_id, chart_hash: activeCast.chart_hash, question_context: context ?? undefined, retry }),
        signal: AbortSignal.timeout(600_000) });
      const payload = await response.json() as ApiEnvelope<DivinationInterpretationResult>;
      if (!response.ok || !payload.result) throw new Error(payload.error?.message ?? "解读请求失败，请重试。");
      if (request !== interpretationRequest.current) return;
      setInterpretation(payload.result);
      const reasons = [...payload.warnings];
      if (!payload.result.modern_interpretation && !reasons.length) reasons.push("总体文本解读未生成。");
      setInterpretationError(reasons.length ? reasons.join(" ") : null);
      setMessages(current => [...current.filter(message => !["问题已确认，正在基于本次冻结卦盘读取规则与典籍依据……", "解读部分未完成，已保留原卦盘；可查看下方原因并重试。", "本次解读已恢复或完成，请查看下方总体解读。"].includes(message.content)),
        { role: "assistant", content: reasons.length ? "解读部分未完成，已保留原卦盘；可查看下方原因并重试。" : "本次解读已恢复或完成，请查看下方总体解读。" }]);
    } catch (error) {
      if (request === interpretationRequest.current) setInterpretationError(error instanceof Error && error.name === "TimeoutError" ? "等待解读超时，可重试读取服务端结果；不会重新起卦。" : error instanceof Error ? error.message : "解读服务暂不可用。");
    } finally { if (request === interpretationRequest.current) setInterpretationPending(false); }
  }

  useEffect(() => {
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(resultCacheKey) || "null") as Partial<{
        messages: DivinationChatMessage[];
        reply: DivinationChatReply | null;
        cast: DivinationCastResult | null;
        interpretation: DivinationInterpretationResult | null; questionContext: QuestionContext | null;
      }> | null;
      if (cached && Array.isArray(cached.messages) && cached.cast) {
        setMessages(cached.messages);
        setReply(cached.reply ?? null);
        setCast(cached.cast);
        setInterpretation(cached.interpretation ?? null); setQuestionContext(cached.questionContext ?? null);
        if (cached.reply?.status === "ready" && cached.cast.chart_id) void loadInterpretation(cached.cast, cached.questionContext);
      }
    } catch {
      window.sessionStorage.removeItem(resultCacheKey);
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!restored || !cast) return;
    window.sessionStorage.setItem(resultCacheKey, JSON.stringify({ messages, reply, cast, interpretation, questionContext }));
  }, [cast, interpretation, messages, reply, restored, questionContext]);

  function saveHistory(eventType: string, payload: Record<string, unknown>) {
    sessionId.current ??= crypto.randomUUID();
    const eventId = crypto.randomUUID();
    sequence.current += 1;
    void fetch("/api/session/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId.current, event_id: eventId, event_type: eventType, module: "divination", sequence_no: sequence.current, payload }),
      keepalive: true,
    }).catch(() => undefined);
  }

  async function send(value = input) {
    const content = value.trim();
    if (!content || pending || interpretationPending) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next); setInput(""); setPending(true); setReply(null); setInterpretation(null);
    saveHistory("module2a.chat.user_message", { role: "user", content, message_index: next.length - 1, inference_eligible: false });
    try {
      const response = await fetch("/api/divination/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const payload = await response.json() as ApiEnvelope<DivinationChatReply>;
      if (!response.ok || !payload.result) throw new Error(payload.error?.message ?? "聊天服务暂不可用。");
      const bot = payload.result;
      setReply(bot); setQuestionContext(bot.question_context ?? null);
      setMessages(current => [...current, { role: "assistant", content: bot.message }]);
      saveHistory("module2a.chat.assistant_message", { role: "assistant", content: bot.message, status: bot.status, message_index: next.length, inference_eligible: false });
      let activeCast=cast;
      if (bot.cast_request && !activeCast) {
        const castResponse = await fetch("/api/divination/cast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bot.cast_request, request_id: crypto.randomUUID(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
        const castPayload = await castResponse.json() as ApiEnvelope<DivinationCastResult>;
        const result = castPayload.result;
        if (!castResponse.ok || !result) throw new Error(castPayload.error?.message ?? "起卦服务暂不可用。");
        setCast(result); activeCast=result;
        const completionMessage = `起卦完成：本卦「${result.primary.name}」，${result.moving_lines.length ? `动爻为第 ${result.moving_lines.join("、")} 爻` : "本次无动爻"}，变卦「${result.transformed.name}」。`;
        setMessages(current => [...current, { role: "assistant", content: completionMessage }]);
        saveHistory("module2a.chat.assistant_message", { role: "assistant", content: completionMessage, message_index: next.length + 1, inference_eligible: false });
        saveHistory("module2a.divination.completed", {
          divination_id: crypto.randomUUID(),
          method: bot.cast_request.method,
          primary_hexagram: { number: result.primary.number, name: result.primary.name },
          changed_hexagram: { number: result.transformed.number, name: result.transformed.name },
          moving_lines: result.moving_lines,
          intent: { topic: bot.extraction?.question ?? bot.cast_request.question, symbols: [result.primary.name, result.transformed.name] },
          time_range: bot.extraction?.time_range,
          inference_eligible: true,
        });
      }
      if (bot.status === "ready" && activeCast?.chart_id) {
        const loadingMessage = "问题已确认，正在基于本次冻结卦盘读取规则与典籍依据……";
        setMessages(current => [...current, { role: "assistant", content: loadingMessage }]);
        await loadInterpretation(activeCast, bot.question_context);
      }
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : "服务暂不可用。" }]);
    } finally { setPending(false); }
  }

  const extraction=reply?.extraction;
  return <section className={`panel ${chatStyles.chatPanel}`}><p className="kicker">对话式问卦</p><h2>先说事，再起卦</h2><p className="panel-intro">聊天助手会整理问题、时间范围和起卦数字；本卦、动爻、互卦与变卦均由规则引擎计算。</p><div className={chatStyles.chatHistory} aria-live="polite">{messages.map((message, index) => <p className={`${chatStyles.chatMessage} ${chatStyles[message.role]}`} key={`${message.role}-${index}`}>{message.content}</p>)}</div>{extraction && <details className={chatStyles.extraction}><summary>解析信息（{extraction.source === "llm" ? "LLM" : extraction.source === "unavailable" ? "LLM 暂不可用" : "规则兜底"}）</summary><dl><dt>问题</dt><dd>{extraction.question ?? "未识别"}</dd><dt>时间</dt><dd>{extraction.time_range ?? "未识别"}</dd><dt>方式</dt><dd>{extraction.method ?? "未选择"}</dd>{extraction.numbers?.length ? <><dt>数字</dt><dd>{extraction.numbers.join("、")}</dd></> : null}{extraction.fallback_reason ? <><dt>原因</dt><dd>{extraction.fallback_reason}</dd></> : null}</dl></details>}{reply?.suggestions.length ? <div className={chatStyles.chatSuggestions}>{reply.suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div> : null}<div className={chatStyles.chatCompose}><input value={input} onChange={event => setInput(event.target.value)} onInput={event => setInput(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") send(); }} placeholder="例如：我想问未来三个月的工作，数字 18、27、9" disabled={pending || interpretationPending}/><button className="button button-primary" type="button" onClick={() => send()} disabled={pending || interpretationPending}>{pending ? "处理中……" : "发送"}</button></div>{interpretationPending && <p role="status">正在读取或生成原卦盘解读，刷新后会自动恢复，请稍候……</p>}{interpretationError && <div role="alert"><p>解读未完成：{interpretationError}</p><button type="button" className="button button-primary" disabled={interpretationPending} onClick={() => cast && loadInterpretation(cast, questionContext, true)}>重试解读（不重新起卦）</button></div>}{cast && <HexagramEvolution result={cast} />}{interpretation && <InterpretationPanel result={interpretation} />}</section>;
}
