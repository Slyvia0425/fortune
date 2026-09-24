"use client";

import { useState } from "react";
import chatStyles from "./divination-chatbot.module.css";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { DivinationCastResult, DivinationChatMessage, DivinationChatReply } from "@/lib/contracts/divination";
import HexagramEvolution from "./hexagram-evolution";

const intro = "我是问卦助手。先告诉我你要问的一件事；我会简短确认时间范围和起卦数字，再为你推演卦象。";

export default function DivinationChatbot() {
  const [messages, setMessages] = useState<DivinationChatMessage[]>([{ role: "assistant", content: intro }]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<DivinationChatReply | null>(null);
  const [cast, setCast] = useState<DivinationCastResult | null>(null);

  async function send(value = input) {
    const content = value.trim();
    if (!content || pending) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next); setInput(""); setPending(true); setReply(null); setCast(null);
    try {
      const response = await fetch("/api/divination/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const payload = await response.json() as ApiEnvelope<DivinationChatReply>;
      if (!response.ok || !payload.result) throw new Error(payload.error?.message ?? "聊天服务暂不可用。");
      const bot = payload.result;
      setReply(bot);
      setMessages(current => [...current, { role: "assistant", content: bot.message }]);
      if (bot.cast_request) {
        const castResponse = await fetch("/api/divination/cast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bot.cast_request) });
        const castPayload = await castResponse.json() as ApiEnvelope<DivinationCastResult>;
        const result = castPayload.result;
        if (!castResponse.ok || !result) throw new Error(castPayload.error?.message ?? "起卦服务暂不可用。");
        setCast(result);
        setMessages(current => [...current, { role: "assistant", content: `起卦完成：本卦「${result.primary.name}」，${result.moving_lines.length ? `动爻为第 ${result.moving_lines.join("、")} 爻` : "本次无动爻"}，变卦「${result.transformed.name}」。` }]);
      }
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : "服务暂不可用。" }]);
    } finally { setPending(false); }
  }

  const extraction=reply?.extraction;
  return <section className={`panel ${chatStyles.chatPanel}`}><p className="kicker">对话式问卦</p><h2>先说事，再起卦</h2><p className="panel-intro">聊天助手会整理问题、时间范围和起卦数字；本卦、动爻、互卦与变卦均由规则引擎计算。</p><div className={chatStyles.chatHistory} aria-live="polite">{messages.map((message, index) => <p className={`${chatStyles.chatMessage} ${chatStyles[message.role]}`} key={`${message.role}-${index}`}>{message.content}</p>)}</div>{extraction && <details className={chatStyles.extraction}><summary>解析信息（{extraction.source === "llm" ? "LLM" : "规则兜底"}）</summary><dl><dt>问题</dt><dd>{extraction.question ?? "未识别"}</dd><dt>时间</dt><dd>{extraction.time_range ?? "未识别"}</dd><dt>方式</dt><dd>{extraction.method ?? "未选择"}</dd>{extraction.numbers?.length ? <><dt>数字</dt><dd>{extraction.numbers.join("、")}</dd></> : null}{extraction.fallback_reason ? <><dt>兜底原因</dt><dd>{extraction.fallback_reason}</dd></> : null}</dl></details>}{reply?.suggestions.length ? <div className={chatStyles.chatSuggestions}>{reply.suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div> : null}<div className={chatStyles.chatCompose}><input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") send(); }} placeholder="例如：我想问未来三个月的工作，数字 18 和 27" disabled={pending}/><button className="button button-primary" type="button" onClick={() => send()} disabled={pending}>{pending ? "处理中……" : "发送"}</button></div>{cast && <HexagramEvolution result={cast} />}</section>;
}
