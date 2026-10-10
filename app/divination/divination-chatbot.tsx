"use client";

import { useRef, useState } from "react";
import CollectionButton from "@/app/components/collection-button";
import chatStyles from "./divination-chatbot.module.css";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { DivinationCastResult, DivinationChatMessage, DivinationChatReply, DivinationInterpretationResult } from "@/lib/contracts/divination";
import { createSessionEventId, recordConversationMessage, recordDivinationCompletion } from "@/lib/module4/activity";
import HexagramEvolution from "./hexagram-evolution";
import InterpretationPanel from "./interpretation-panel";

const intro = "我是问卦助手。先告诉我你要问的一件事；我会简短确认时间范围和起卦数字，再为你推演卦象。";

export default function DivinationChatbot() {
  const [messages, setMessages] = useState<DivinationChatMessage[]>([{ role: "assistant", content: intro }]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<DivinationChatReply | null>(null);
  const [cast, setCast] = useState<DivinationCastResult | null>(null);
  const sessionId = useRef<string | null>(null);
  const sequence = useRef(0);
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const [interpretation, setInterpretation] = useState<DivinationInterpretationResult | null>(null);

  function currentSessionId() {
    sessionId.current ??= createSessionEventId();
    return sessionId.current;
  }

  function enqueueSync(task: () => Promise<unknown>) {
    syncQueue.current = syncQueue.current.then(async () => { await task(); }).catch(() => undefined);
  }

  function persistMessage(role: "user" | "assistant", content: string) {
    const sessionIdValue = currentSessionId();
    const sequenceNo = ++sequence.current;
    enqueueSync(() => recordConversationMessage(sessionIdValue, role, content, sequenceNo));
  }

  async function send(value = input) {
    const content = value.trim();
    if (!content || pending) return;
    const next = [...messages, { role: "user" as const, content }];
    persistMessage("user", content);
    setMessages(next); setInput(""); setPending(true); setReply(null); setCast(null); setInterpretation(null);
    try {
      const response = await fetch("/api/divination/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const payload = await response.json() as ApiEnvelope<DivinationChatReply>;
      if (!response.ok || !payload.result) throw new Error(payload.error?.message ?? "聊天服务暂不可用。");
      const bot = payload.result;
      setReply(bot);
      setMessages(current => [...current, { role: "assistant", content: bot.message }]);
      persistMessage("assistant", bot.message);
      if (bot.cast_request) {
        const castResponse = await fetch("/api/divination/cast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bot.cast_request) });
        const castPayload = await castResponse.json() as ApiEnvelope<DivinationCastResult>;
        const result = castPayload.result;
        if (!castResponse.ok || !result) throw new Error(castPayload.error?.message ?? "起卦服务暂不可用。");
        setCast(result);
        const completionMessage = `起卦完成：本卦「${result.primary.name}」，${result.moving_lines.length ? `动爻为第 ${result.moving_lines.join("、")} 爻` : "本次无动爻"}，变卦「${result.transformed.name}」。`;
        setMessages(current => [...current, { role: "assistant", content: completionMessage }]);
        persistMessage("assistant", completionMessage);
        const sessionIdValue = currentSessionId();
        const sequenceNo = ++sequence.current;
        enqueueSync(() => recordDivinationCompletion(sessionIdValue, {
          divinationId: castPayload.session_id ?? createSessionEventId(),
          question: bot.extraction?.question ?? bot.cast_request?.question ?? content,
          timeRange: bot.extraction?.time_range ?? bot.cast_request?.time_range,
          method: bot.cast_request?.method ?? "numbers",
          primaryHexagram: { ...result.primary },
          changedHexagram: { ...result.transformed },
          movingLines: result.moving_lines,
          sourceRefs: result.reading?.source_refs.map(source => source.source_id) ?? [],
        }, sequenceNo));
        const interpretationResponse = await fetch("/api/divination/interpret", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: bot.cast_request.question, time_range: bot.cast_request.time_range, cast_result: result }) });
        const interpretationPayload = await interpretationResponse.json() as ApiEnvelope<DivinationInterpretationResult>;
        if (!interpretationResponse.ok || !interpretationPayload.result) throw new Error(interpretationPayload.error?.message ?? "典籍证据请求失败。");
        setInterpretation(interpretationPayload.result);
        const interpretationMessage = interpretationPayload.result.modern_interpretation ? "已根据本地典籍证据生成现代中文转述；每一段都保留了来源 ID。" : "已找到本地典籍证据；LLM 暂不可用，因此没有补写现代解释。";
        setMessages(current => [...current, { role: "assistant", content: interpretationMessage }]);
        persistMessage("assistant", interpretationMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "服务暂不可用。";
      setMessages(current => [...current, { role: "assistant", content: message }]);
      persistMessage("assistant", message);
    } finally { setPending(false); }
  }

  const extraction=reply?.extraction;
  return <section className={`panel ${chatStyles.chatPanel}`}><p className="kicker">对话式问卦</p><h2>先说事，再起卦</h2><p className="panel-intro">聊天助手会整理问题、时间范围和起卦数字；本卦、动爻、互卦与变卦均由规则引擎计算。</p><div className={chatStyles.chatHistory} aria-live="polite">{messages.map((message, index) => <p className={`${chatStyles.chatMessage} ${chatStyles[message.role]}`} key={`${message.role}-${index}`}>{message.content}</p>)}</div>{extraction && <details className={chatStyles.extraction}><summary>解析信息（{extraction.source === "llm" ? "LLM" : "规则兜底"}）</summary><dl><dt>问题</dt><dd>{extraction.question ?? "未识别"}</dd><dt>时间</dt><dd>{extraction.time_range ?? "未识别"}</dd><dt>方式</dt><dd>{extraction.method ?? "未选择"}</dd>{extraction.numbers?.length ? <><dt>数字</dt><dd>{extraction.numbers.join("、")}</dd></> : null}{extraction.fallback_reason ? <><dt>兜底原因</dt><dd>{extraction.fallback_reason}</dd></> : null}</dl></details>}{reply?.suggestions.length ? <div className={chatStyles.chatSuggestions}>{reply.suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div> : null}<div className={chatStyles.chatCompose}><input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") send(); }} placeholder="例如：我想问未来三个月的工作，数字 18 和 27" disabled={pending}/><button className="button button-primary" type="button" onClick={() => send()} disabled={pending}>{pending ? "处理中……" : "发送"}</button></div>{messages.length > 1 && <CollectionButton action="question" itemType="divination_chat" label="收藏本次问卦对话" module="divination" sourceId={`divination-chat:${messages.length}:${messages[messages.length - 1]?.content.slice(0, 50) ?? "session"}`} step="chat" summary={messages.map(message => message.content).join(" ").slice(0, 500)} tags={["易卦", "对话记录"]} title="易卦问事对话" snapshot={{ messages }} />}{cast && <HexagramEvolution result={cast} />}{interpretation && <InterpretationPanel result={interpretation} />}</section>;
}
