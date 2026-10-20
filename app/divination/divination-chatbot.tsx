"use client";

import { useEffect, useRef, useState } from "react";
import chatStyles from "./divination-chatbot.module.css";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { DialogueState, FrozenQuestionRecord, DivinationCastResult, DivinationChatMessage, DivinationChatReply, DivinationInterpretationResult } from "@/lib/contracts/divination";
import HexagramEvolution from "./hexagram-evolution";
import InterpretationPanel from "./interpretation-panel";
import { canCastChatReply } from "@/lib/divination/chat-gate";

const intro = "我是问卦助手。先告诉我你要问的一件事；我会简短确认时间范围和起卦数字，再为你推演卦象。";
const resultCacheKey = "fortune.divination.latest-result.v2";

export default function DivinationChatbot() {
  const [messages, setMessages] = useState<DivinationChatMessage[]>([{ role: "assistant", content: intro }]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<DivinationChatReply | null>(null);
  const [cast, setCast] = useState<DivinationCastResult | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const draftRevision = useRef<number | undefined>(undefined);
  const sessionId = useRef<string | null>(null);
  const sequence = useRef(0);
  const [interpretation, setInterpretation] = useState<DivinationInterpretationResult | null>(null);
  const [restored, setRestored] = useState(false);
  const [interpretationPending, setInterpretationPending] = useState(false);
  const [interpretationWarnings, setInterpretationWarnings] = useState<string[]>([]);
  const [interpretationError, setInterpretationError] = useState<string | null>(null);
  const interpretationRequest = useRef(0);

  async function loadInterpretation(activeCast: DivinationCastResult, retry = false) {
    const request = ++interpretationRequest.current;
    setInterpretationPending(true); setInterpretationError(null); setInterpretationWarnings([]);
    try {
      const response = await fetch("/api/divination/interpret", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chart_id: activeCast.chart_id, chart_hash: activeCast.chart_hash, retry }),
        signal: AbortSignal.timeout(600_000) });
      const payload = await response.json() as ApiEnvelope<DivinationInterpretationResult>;
      if (!response.ok || !payload.result) throw new Error(payload.error?.message ?? "解读请求失败，请重试。");
      if (request !== interpretationRequest.current) return;
      setInterpretation(payload.result);
      const complete = Boolean(payload.result.modern_interpretation) && !["partial", "structured_available", "reasoning_failed"].includes(payload.result.analysis_status ?? "");
      setInterpretationWarnings(complete ? payload.warnings : []);
      const reasons = complete ? [] : [...payload.warnings];
      if (!payload.result.modern_interpretation && !reasons.length) reasons.push("总体文本解读未生成。");
      setInterpretationError(reasons.length ? reasons.join(" ") : null);
      setMessages(current => [...current.filter(message => !["问题已确认，正在基于本次冻结卦盘读取规则与典籍依据……", "解读部分未完成，已保留原卦盘；可查看下方原因并重试。", "本次解读已恢复或完成，请查看下方总体解读。"].includes(message.content)),
        { role: "assistant", content: reasons.length ? "解读部分未完成，已保留原卦盘；可查看下方原因并重试。" : "本次解读已恢复或完成，请查看下方总体解读。" }]);
    } catch (error) {
      if (request === interpretationRequest.current) setInterpretationError(error instanceof Error && error.name === "TimeoutError" ? "等待解读超时，可重试读取服务端结果；不会重新起卦。" : error instanceof Error ? error.message : "解读服务暂不可用。");
    } finally { if (request === interpretationRequest.current) setInterpretationPending(false); }
  }

  useEffect(() => {
    let cancelled=false;
    void (async()=>{
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(resultCacheKey) || "null") as Partial<{
        messages: DivinationChatMessage[];
        reply: DivinationChatReply | null;
        cast: DivinationCastResult | null;
        interpretation: DivinationInterpretationResult | null; conversationId:string;
      }> | null;
      if (cached && Array.isArray(cached.messages)) {
        setMessages(cached.messages);
        setCast(cached.cast??null);
        // Confirmed interpretations must be re-authorized/version-checked by the
        // server. A browser's old PR-4/5 prose cannot masquerade as PR-6 output.
        setInterpretation(cached.cast?.confirmation_id?null:cached.interpretation??null);
        if(cached.conversationId){
          const response=await fetch("/api/divination/dialogue",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversation_id:cached.conversationId})});
          const payload=await response.json() as ApiEnvelope<DialogueState>;
          if(!response.ok||!payload.result)throw new Error(payload.error?.message??"草稿恢复失败。");
          if(cancelled)return;
          conversationId.current=payload.result.conversation_id;draftRevision.current=payload.result.revision;
          setReply(payload.result.reply);setMessages(payload.result.messages);
        }
        if(cached.cast?.chart_id&&cached.cast.confirmation_id){
          const response=await fetch("/api/divination/frozen",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chart_id:cached.cast.chart_id})});
          const payload=await response.json() as ApiEnvelope<FrozenQuestionRecord>;
          if(cancelled)return;
          if(!response.ok||payload.result?.confirmed_question?.confirmation_id!==cached.cast.confirmation_id)throw new Error("原卦盘确认记录无法恢复，请重试读取。");
          setCast(payload.result.cast);
          void loadInterpretation(payload.result.cast);
        }
      }
    } catch(error) {
      if(!cancelled)setInterpretationError(error instanceof Error?error.message:"恢复失败，原结果已保留。");
    } finally {
      if(!cancelled)setRestored(true);
    }
    })();
    return()=>{cancelled=true;};
  }, []);

  useEffect(() => {
    if (!restored) return;
    window.sessionStorage.setItem(resultCacheKey, JSON.stringify({ messages, reply, cast, interpretation, conversationId:conversationId.current }));
  }, [cast, interpretation, messages, reply, restored]);

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

  async function send(value = input, retryMessageId?:string) {
    const content = value.trim();
    if (!content || pending || interpretationPending || !restored || cast) return;
    const next = retryMessageId?messages:[...messages, { role: "user" as const, content }];
    setMessages(next); setInput(""); setPending(true); setReply(null); setInterpretation(null);
    saveHistory("module2a.chat.user_message", { role: "user", content, message_index: next.length - 1, inference_eligible: false });
    try {
      const response = await fetch("/api/divination/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages:[{role:"user",content}],message_id:retryMessageId??crypto.randomUUID(),conversation_id:conversationId.current,draft_revision:draftRevision.current,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const payload = await response.json() as ApiEnvelope<DivinationChatReply>;
      if (!response.ok || !payload.result) {
        if(typeof payload.error?.details?.conversation_id==="string")conversationId.current=payload.error.details.conversation_id;
        if(typeof payload.error?.details?.draft_revision==="number")draftRevision.current=payload.error.details.draft_revision;
        throw new Error(payload.error?.message ?? "聊天服务暂不可用。");
      }
      const bot = payload.result;
      setReply(bot);conversationId.current=bot.conversation_id;draftRevision.current=bot.draft_revision;
      setMessages(current => [...current, { role: "assistant", content: bot.message }]);
      saveHistory("module2a.chat.assistant_message", { role: "assistant", content: bot.message, status: bot.status, message_index: next.length, inference_eligible: false });
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : "服务暂不可用。" }]);
    } finally { setPending(false); }
  }

  async function confirmAndCast(){
    if(!reply||pending||interpretationPending||cast)return;
    setPending(true);
    try{
      let confirmedReply=reply;
      if(reply.status==="ready_for_confirmation"&&reply.confirmation_preview){
        const response=await fetch("/api/divination/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversation_id:reply.conversation_id,revision:reply.draft_revision,question_hash:reply.confirmation_preview.question_hash,confirmed:true})});
        const payload=await response.json() as ApiEnvelope<DivinationChatReply>;
        if(!response.ok||!payload.result)throw new Error(payload.error?.message??"确认失败。");
        confirmedReply=payload.result;setReply(confirmedReply);
      }
      if(!canCastChatReply(confirmedReply))throw new Error("请先确认当前问题。");
      const confirmation=confirmedReply.confirmed_question!;
      // Deterministic retry identity survives refresh and multiple tabs.
      const response=await fetch("/api/divination/cast",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirmation_id:confirmation.confirmation_id,request_id:confirmation.confirmation_id})});
      const payload=await response.json() as ApiEnvelope<DivinationCastResult>;
      if(!response.ok||!payload.result)throw new Error(payload.error?.message??"起卦失败，可重试原确认记录。");
      const result=payload.result;
      setCast(result);
      const completionMessage=`起卦完成：本卦「${result.primary.name}」，${result.moving_lines.length?`动爻为第 ${result.moving_lines.join("、")} 爻`:"本次无动爻"}，变卦「${result.transformed.name}」。`;
      setMessages(current=>[...current,{role:"assistant",content:completionMessage}]);
      saveHistory("module2a.divination.completed",{divination_id:result.chart_id,confirmation_id:confirmation.confirmation_id,method:"three_numbers",primary_hexagram:{number:result.primary.number,name:result.primary.name},changed_hexagram:{number:result.transformed.number,name:result.transformed.name},moving_lines:result.moving_lines,intent:{topic:confirmation.normalized_question,symbols:[result.primary.name,result.transformed.name]},inference_eligible:true});
      await loadInterpretation(result);
    }catch(error){setMessages(current=>[...current,{role:"assistant",content:error instanceof Error?error.message:"确认起卦未完成。"}]);}
    finally{setPending(false);}
  }

  function startNewQuestion(){
    if(pending||interpretationPending)return;
    conversationId.current=undefined;draftRevision.current=undefined;
    setMessages([{role:"assistant",content:intro}]);setReply(null);setCast(null);setInterpretation(null);setInterpretationError(null);setInterpretationWarnings([]);setInput("");
  }

  const preview=reply?.confirmation_preview;
  const extraction=reply?.extraction;
  return <section className={`panel ${chatStyles.chatPanel}`}><p className="kicker">对话式问卦</p><h2>先说事，再起卦</h2><p className="panel-intro">聊天助手会整理问题、时间范围和起卦数字；本卦、动爻、互卦与变卦均由规则引擎计算。</p><div className={chatStyles.chatHistory} aria-live="polite">{messages.map((message, index) => <p className={`${chatStyles.chatMessage} ${chatStyles[message.role]}`} key={`${message.role}-${index}`}>{message.content}</p>)}</div>{extraction && <details className={chatStyles.extraction}><summary>解析信息（{extraction.source === "llm" ? "LLM" : extraction.source === "unavailable" ? "LLM 暂不可用" : "规则兜底"}）</summary><dl><dt>问题</dt><dd>{extraction.question ?? "未识别"}</dd><dt>时间</dt><dd>{extraction.time_range ?? "未识别"}</dd><dt>方式</dt><dd>{extraction.method ?? "未选择"}</dd>{extraction.numbers?.length ? <><dt>数字</dt><dd>{extraction.numbers.join("、")}</dd></> : null}{extraction.fallback_reason ? <><dt>原因</dt><dd>{extraction.fallback_reason}</dd></> : null}</dl></details>}{reply?.suggestions.length ? <div className={chatStyles.chatSuggestions}>{reply.suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div> : null}{reply?.status==="blocked"&&reply.retry_message&&!cast&&<button className="button" disabled={pending||interpretationPending} onClick={()=>send(reply.retry_message!.content,reply.retry_message!.message_id)}>重试问事预检</button>}{preview && !cast && <div className="panel" aria-label="确认本次问事"><p>本次只问：{preview.normalized_question}</p><p>起卦数字：{preview.numbers.join("、")}；时区：{preview.timezone}</p>{preview.question_context.initiator.value&&<p>提问人：{preview.question_context.initiator.value}</p>}{preview.question_context.number_provider.value&&<p>提供数字的人：{preview.question_context.number_provider.value}</p>}{preview.question_context.exclusions.map((text,index)=><p key={index}>本次不问：{text}</p>)}{preview.question_context.time_expression.value && <p>时间范围：{preview.question_context.time_expression.value}</p>}{preview.question_context.process_stage.value && <p>当前阶段：{preview.question_context.process_stage.value}</p>}{preview.question_context.perspective_person.value && <p>问事视角：{preview.question_context.perspective_person.value}</p>}{preview.question_context.target_entities.map(entity=><p key={entity.entity_id}>对象：{entity.label}</p>)}{preview.question_context.relationships.map((relation,index)=><p key={index}>关系：{relation.evidence?.text??relation.relation}</p>)}{preview.question_context.known_facts.map((fact,index)=><p key={index}>背景：{fact.value}</p>)}<button className="button button-primary" disabled={pending||interpretationPending} onClick={confirmAndCast}>确认这个问题并起卦</button><button className="button" disabled={pending||interpretationPending} onClick={()=>{setReply(null);setInput(preview.normalized_question);}}>修改问题</button></div>}{reply?.status==="confirmed"&&!cast&&<button className="button button-primary" disabled={pending||interpretationPending} onClick={confirmAndCast}>继续起卦（使用原确认记录）</button>}<div className={chatStyles.chatCompose}><input value={input} onChange={event => setInput(event.target.value)} onInput={event => setInput(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") send(); }} placeholder="例如：我想问未来三个月的工作，数字 18、27、9" disabled={pending || interpretationPending || !restored || Boolean(cast)}/><button className="button button-primary" type="button" onClick={() => send()} disabled={pending || interpretationPending || !restored || Boolean(cast)}>{pending ? "处理中……" : "发送"}</button></div>{interpretationPending && <p role="status">正在读取或生成原卦盘解读，刷新后会自动恢复，请稍候……</p>}{interpretationWarnings.length > 0 && <details><summary>解读提示</summary><ul>{interpretationWarnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}{interpretationError && <div role="alert"><p>解读未完成：{interpretationError}</p><button type="button" className="button button-primary" disabled={interpretationPending} onClick={() => cast && loadInterpretation(cast, true)}>重试解读（不重新起卦）</button></div>}<button className="button" disabled={pending||interpretationPending||!restored} onClick={startNewQuestion}>开启新问题</button>{cast && <HexagramEvolution result={cast} />}{interpretation && <InterpretationPanel result={interpretation} />}</section>;
}
