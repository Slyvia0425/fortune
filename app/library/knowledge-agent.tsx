"use client";

import {
  BookOpen,
  Bot,
  ExternalLink,
  FileText,
  Library,
  MessageSquarePlus,
  NotebookPen,
  Plus,
  Send,
  Sparkles,
  Tags,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSourceKind, PublicAgentSource } from "@/lib/agent/types";
import { module4Api } from "@/lib/module4/api";
import type {
  AgentUsedRecord,
  CollectionItem,
  NoteItem,
  PersonProfile,
  TagItem,
} from "@/lib/module4/types";

interface AgentSource {
  id: string;
  kind: AgentSourceKind;
  title: string;
  sourceId: string | null;
  excerpt: string;
  url: string | null;
  tags: string[];
  itemType: string | null;
  module: string | null;
}

interface AgentMessage {
  id: string;
  role: "agent" | "user";
  content: string;
  sources: AgentSource[];
}

interface KnowledgeAgentProps {
  collections: CollectionItem[];
  notes: NoteItem[];
  tags: TagItem[];
  profiles: PersonProfile[];
  userId: string;
  loading: boolean;
  onAddCollection: () => void;
  onAddNote: () => void;
}

const quickPrompts = [
  "概览全部资料",
  "五行与十神有哪些依据",
  "求签与卦象有哪些记录",
  "汇总我的个人笔记",
  "结合命盘与个人记录分析近期事业",
];

function createMessageId(role: AgentMessage["role"]): string {
  return `${role}-${globalThis.crypto.randomUUID()}`;
}

function compactText(value: string, max = 150): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function isMessageHeading(line: string): boolean {
  return /^\*\*[^*].*\*\*$/.test(line.trim());
}

function formatMessageLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*[*+-]\s+/, "  - ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function sourceUrl(item: CollectionItem): string | null {
  const value = item.source_metadata?.url;
  return typeof value === "string" && value.trim() ? value : null;
}

function toCollectionSource(item: CollectionItem): AgentSource {
  const metadataSummary = item.source_metadata?.summary;
  const metadataModule = item.source_metadata?.module;
  const metadataTags = Array.isArray(item.source_metadata?.tags)
    ? item.source_metadata.tags.map((tag) => String(tag))
    : [];
  return {
    id: item.collection_id,
    kind: "collection",
    title: item.title || item.source_id || "未命名收藏",
    sourceId: item.source_id,
    excerpt:
      typeof metadataSummary === "string"
        ? compactText(metadataSummary)
        : `${item.item_type} · 收藏于知识库`,
    url: sourceUrl(item),
    tags: item.tags?.length ? item.tags : metadataTags,
    itemType: item.item_type,
    module: typeof metadataModule === "string" ? metadataModule : null,
  };
}

function toNoteSource(note: NoteItem): AgentSource {
  return {
    id: note.note_id,
    kind: "note",
    title: note.title || "未命名笔记",
    sourceId: note.source_id,
    excerpt: compactText(note.body),
    url: null,
    tags: note.tags,
    itemType: "personal_note",
    module: "notes",
  };
}

function toPublicSource(source: PublicAgentSource): AgentSource {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    sourceId: source.source_id,
    excerpt: compactText(source.excerpt),
    url: source.url,
    tags: [],
    itemType: source.kind,
    module: source.kind,
  };
}

function analysisKind(record: AgentUsedRecord): AgentSourceKind {
  const itemType = record.item_type.toLowerCase();
  const moduleName = (record.module || "").toLowerCase();
  if (itemType === "personal_note" || moduleName === "notes") return "note";
  if (itemType.startsWith("bazi") || moduleName === "bazi") return "bazi";
  if (itemType.startsWith("divination") || moduleName === "divination") return "divination";
  if (itemType.startsWith("sign") || moduleName === "guanyin") return "guanyin";
  if (moduleName === "knowledge") return "knowledge";
  return "collection";
}

function toAnalysisSource(record: AgentUsedRecord): AgentSource {
  return {
    id: record.id,
    kind: analysisKind(record),
    title: record.title,
    sourceId: record.source_id,
    excerpt: compactText(record.excerpt),
    url: record.url,
    tags: record.tags,
    itemType: record.item_type,
    module: record.module,
  };
}

function queryTerms(query: string): string[] {
  const normalized = query.toLowerCase().replace(/\s+/g, "");
  const terms = new Set<string>();
  if (normalized.length > 1) terms.add(normalized);

  for (const chunk of normalized.split(/[，。！？、,.!?;；:：]+/)) {
    if (chunk.length > 1) terms.add(chunk);
  }

  const hanCharacters = Array.from(normalized).filter((value) => /[\u3400-\u9fff]/.test(value));
  for (let index = 0; index < hanCharacters.length - 1; index += 1) {
    terms.add(`${hanCharacters[index]}${hanCharacters[index + 1]}`);
  }
  return [...terms];
}

function scoreSource(source: AgentSource, terms: string[]): number {
  const fields = [
    { value: source.title, weight: 8 },
    { value: source.sourceId || "", weight: 6 },
    { value: source.tags.join(" "), weight: 5 },
    { value: source.excerpt, weight: 2 },
  ];
  let score = 0;
  for (const term of terms) {
    for (const field of fields) {
      if (field.value.toLowerCase().includes(term)) {
        score += field.weight;
      }
    }
  }
  return score;
}

function kindLabel(kind: AgentSource["kind"]): string {
  const labels: Record<AgentSource["kind"], string> = {
    collection: "个人收藏",
    note: "个人笔记",
    knowledge: "典籍",
    guanyin: "观音灵签",
    divination: "易卦",
    bazi: "八字",
  };
  return labels[kind];
}

function kindIcon(kind: AgentSource["kind"]) {
  if (kind === "collection") return <Library size={14} />;
  if (kind === "note") return <NotebookPen size={14} />;
  if (kind === "guanyin") return <FileText size={14} />;
  if (kind === "divination") return <Bot size={14} />;
  if (kind === "bazi") return <Tags size={14} />;
  return <BookOpen size={14} />;
}

type AgentIntent = "overview" | "bazi" | "divination" | "notes" | "search";

interface AnswerContext {
  intent: AgentIntent;
  collections: CollectionItem[];
  notes: NoteItem[];
  tags: TagItem[];
}

function detectIntent(query: string): AgentIntent {
  const normalized = query.replace(/\s+/g, "").toLowerCase();
  if (/(笔记|批注|备注)/.test(normalized)) return "notes";
  if (/(求签|签文|灵签|卦象|起卦|易卦|六爻|爻辞|观音|卦)/.test(normalized)) return "divination";
  if (/(五行|十神|八字|命盘|排盘|日主|用神|天干|地支)/.test(normalized)) return "bazi";
  if (/(概览|全部资料|所有资料|汇总|统计|多少|全部|所有)/.test(normalized)) return "overview";
  return "search";
}

function publicQueriesForIntent(intent: AgentIntent): string[] {
  if (intent === "bazi") return ["五行", "十神", "八字"];
  if (intent === "divination") return ["周易", "灵签"];
  if (intent === "overview") return ["周易", "五行"];
  return [];
}

function matchesIntent(source: AgentSource, intent: AgentIntent): boolean {
  const itemType = source.itemType ?? "";
  const moduleName = source.module ?? "";
  const haystack = `${source.title} ${source.excerpt}`;
  if (intent === "notes") {
    return source.kind === "note" || itemType === "personal_note";
  }
  if (intent === "bazi") {
    return (
      source.kind === "bazi" ||
      moduleName === "bazi" ||
      itemType.startsWith("bazi") ||
      /五行|十神|八字|命理|日主|天干|地支/.test(haystack)
    );
  }
  if (intent === "divination") {
    return (
      source.kind === "divination" ||
      source.kind === "guanyin" ||
      moduleName === "divination" ||
      moduleName === "guanyin" ||
      itemType.startsWith("divination") ||
      itemType.startsWith("sign") ||
      /求签|签文|灵签|卦象|易卦|六爻|爻辞|周易|卦/.test(haystack)
    );
  }
  return true;
}

function intentHeading(intent: AgentIntent): string {
  const headings: Record<AgentIntent, string> = {
    overview: "资料概览",
    bazi: "五行与十神依据",
    divination: "求签与卦象记录",
    notes: "个人笔记汇总",
    search: "跨模块检索",
  };
  return headings[intent];
}

function renderSources(sources: AgentSource[], limit: number): string[] {
  const lines: string[] = [];
  sources.slice(0, limit).forEach((item, index) => {
    lines.push(
      "",
      `${index + 1}. ${kindLabel(item.kind)} · ${item.title}`,
      item.sourceId ? `来源标识：${item.sourceId}` : "来源标识：知命智库",
      item.excerpt,
    );
  });
  return lines;
}

function buildOverviewAnswer(context: AnswerContext, sources: AgentSource[]): string {
  const moduleLabels: Record<string, string> = {
    bazi: "八字",
    divination: "易卦",
    guanyin: "灵签",
    knowledge: "典籍",
    notes: "笔记",
  };
  const moduleCounts = context.collections.reduce<Record<string, number>>((acc, item) => {
    const moduleName =
      typeof item.source_metadata?.module === "string" ? item.source_metadata.module : "other";
    acc[moduleName] = (acc[moduleName] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(moduleCounts)
    .map(([module, count]) => `${moduleLabels[module] ?? module} ${count} 条`)
    .join("、");

  const lines = [
    `当前个人知识库共 ${context.collections.length} 条收藏、${context.notes.length} 条笔记、${context.tags.length} 个标签。`,
  ];
  if (breakdown) lines.push(`收藏按模块分布：${breakdown}。`);
  lines.push("公开资料索引包含 764 条结构化典籍页面、100 支观音灵签和 64 卦阅读依据。");
  if (sources.length) {
    lines.push("", "最近可参考的内容：", ...renderSources(sources, 3));
  } else {
    lines.push(
      "",
      "还没有个人收藏或笔记；在八字、易卦、灵签、典籍各页面点击收藏后，这里会自动汇总。",
    );
  }
  lines.push("", "以上统计来自知命智库的真实记录，不包含超出来源的推断。");
  return lines.join("\n");
}

function buildLocalAnswer(context: AnswerContext, sources: AgentSource[]): string {
  const { intent } = context;
  if (intent === "overview") {
    return buildOverviewAnswer(context, sources);
  }

  if (!sources.length) {
    if (intent === "notes") {
      return [
        "个人笔记暂为空。",
        "",
        "可以在八字、易卦、灵签或典籍页面收藏内容，并在知命智库中新建笔记；笔记会保留 source_id。",
      ].join("\n");
    }
    if (intent === "bazi") {
      return [
        "目前没有找到五行与十神的对应依据。",
        "",
        "可以先在八字页完成一次排盘并收藏结果，再回来提问；公开典籍中的五行、十神、天干地支页面也会一并纳入检索。",
      ].join("\n");
    }
    if (intent === "divination") {
      return [
        "目前没有找到求签或卦象记录。",
        "",
        "可以先在易卦页起卦、在灵签页抽签并收藏结果，知命智库会自动建立来源链。",
      ].join("\n");
    }
    return [
      "我在典籍、灵签、易卦、八字和个人资料中没有找到与这个问题直接相关的记录。",
      "",
      "你可以换一个关键词，或先收藏需要长期追踪的资料。",
    ].join("\n");
  }

  const lines = [`${intentHeading(intent)}：共找到 ${sources.length} 条保留来源的记录。`];
  lines.push(...renderSources(sources, intent === "notes" ? 5 : 4));
  if (intent === "notes") {
    lines.push("", "以上笔记保留各自的 source_id，公共来源变更不会改写你的个人内容。");
  } else if (intent === "bazi") {
    lines.push(
      "",
      "依据顺序：先核对出生时间与四柱，再按五行生克、十神关系与调候用神阅读典籍原文；个人排盘记录与公开文献分别标注来源。",
    );
  } else if (intent === "divination") {
    lines.push(
      "",
      "结果区分起卦记录、卦辞、彖传、象传与动爻原文；签文记录保留签号与所问领域。",
    );
  } else {
    lines.push("", "以上结果来自公开知识、术数资料与个人知识库，不包含超出来源的推断。");
  }
  return lines.join("\n");
}

export default function KnowledgeAgent({
  collections,
  notes,
  tags,
  profiles,
  userId,
  loading,
  onAddCollection,
  onAddNote,
}: KnowledgeAgentProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const allSources = useMemo(
    () => [
      ...collections.map(toCollectionSource),
      ...notes.map(toNoteSource),
    ],
    [collections, notes],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(`module4-agent-${userId}`);
      if (stored) {
        try {
          setMessages(JSON.parse(stored) as AgentMessage[]);
          return;
        } catch {
          window.localStorage.removeItem(`module4-agent-${userId}`);
        }
      }

      setMessages([
        {
          id: createMessageId("agent"),
          role: "agent",
          content: [
            "我是知命智库助手。",
            "我会先定位人物档案和问题领域，再结合命盘、签卦、典籍、个人收藏与笔记给出分析，而不是单纯罗列来源。",
          ].join("\n"),
          sources: [],
        },
      ]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId]);

  useEffect(() => {
    if (messages.length) {
      window.localStorage.setItem(`module4-agent-${userId}`, JSON.stringify(messages));
    }
  }, [messages, userId]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, thinking]);

  async function loadPublicSources(queries: string[]): Promise<AgentSource[]> {
    if (!queries.length) return [];
    const batches = await Promise.all(
      queries.map(async (query) => {
        try {
          const response = await fetch(`/api/agent/search?q=${encodeURIComponent(query)}`);
          if (!response.ok) return [];
          const payload = (await response.json()) as { result?: PublicAgentSource[] };
          return (payload.result ?? []).map(toPublicSource);
        } catch {
          return [];
        }
      }),
    );
    const unique = new Map<string, AgentSource>();
    for (const source of batches.flat()) {
      if (!unique.has(source.id)) unique.set(source.id, source);
    }
    return [...unique.values()];
  }

  async function answer(query: string) {
    const intent = detectIntent(query);
    const terms = queryTerms(query);
    try {
      const analysis = await module4Api.analyzeQuestion(
        userId,
        query,
        activeProfileId || undefined,
      );
      const response: AgentMessage = {
        id: createMessageId("agent"),
        role: "agent",
        content: analysis.answer,
        sources: analysis.used_records.map(toAnalysisSource).slice(0, 6),
      };
      setMessages((current) => [...current, response]);
      setThinking(false);
      return;
    } catch {
      // The deterministic local path keeps the assistant usable if Module 4 is offline.
    }

    const publicSources = await loadPublicSources(publicQueriesForIntent(intent));
    const pool = [...allSources, ...publicSources].filter((source) =>
      matchesIntent(source, intent),
    );
    let candidates = pool
      .map((source) => ({ source, score: scoreSource(source, terms) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.source);

    if (!candidates.length) candidates = pool.slice(0, intent === "notes" ? 5 : 8);

    const response: AgentMessage = {
      id: createMessageId("agent"),
      role: "agent",
      content: buildLocalAnswer({ intent, collections, notes, tags }, candidates),
      sources: candidates.slice(0, 4),
    };
    window.setTimeout(() => {
      setMessages((current) => [...current, response]);
      setThinking(false);
    }, 260);
  }

  function sendMessage(rawQuery: string) {
    const query = rawQuery.trim();
    if (!query || thinking) return;

    setMessages((current) => [
      ...current,
      {
        id: createMessageId("user"),
        role: "user",
        content: query,
        sources: [],
      },
    ]);
    setDraft("");
    setThinking(true);
    answer(query);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(draft);
  }

  function resetConversation() {
    const initial: AgentMessage[] = [
      {
        id: createMessageId("agent"),
        role: "agent",
        content: "已开始新的对话。你可以继续询问典籍、灵签、易卦、八字或个人资料。",
        sources: [],
      },
    ];
    setMessages(initial);
    setDraft("");
  }

  return (
    <section className="page-shell agent-shell" id="agent">
      <div className="agent-card">
        <header className="agent-header">
          <span className="agent-mark"><Bot size={22} /></span>
          <div>
            <p className="kicker">FORTUNE KNOWLEDGE HUB</p>
            <h2>知命智库问答</h2>
          </div>
          <div className="agent-state">
            <span className={loading ? "status-dot offline" : "status-dot"} />
            <span>{loading ? "正在读取个人资料" : "个人资料已就绪，跨模块检索已开启"}</span>
          </div>
          <button
            aria-label="开始新对话"
            onClick={resetConversation}
            title="开始新对话"
            type="button"
          >
            <MessageSquarePlus size={17} />
          </button>
        </header>

        <div className="agent-transcript" ref={transcriptRef}>
          {messages.map((message) => (
            <article className={`agent-message ${message.role}`} key={message.id}>
              <span className="message-avatar">
                {message.role === "agent" ? <Sparkles size={15} /> : "我"}
              </span>
              <div className="message-content">
                <div className="message-bubble">
                  {message.content.split("\n").map((line, index) => (
                    <p
                      className={isMessageHeading(line) ? "message-heading" : undefined}
                      key={`${message.id}-${index}`}
                    >
                      {formatMessageLine(line) || "\u00a0"}
                    </p>
                  ))}
                </div>
                {message.sources.length ? (
                  <div className="agent-sources">
                    {message.sources.map((source) => (
                      <div className="agent-source" key={`${message.id}-${source.id}`}>
                        <span className="source-kind">{kindIcon(source.kind)}</span>
                        <div>
                          <strong>{source.title}</strong>
                          <small>
                            {kindLabel(source.kind)}
                            {source.sourceId ? ` · ${source.sourceId}` : ""}
                          </small>
                        </div>
                        {source.url ? (
                          <a href={source.url} rel="noreferrer" target="_blank">
                            <ExternalLink size={14} />
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {thinking ? (
            <article className="agent-message agent">
              <span className="message-avatar"><Sparkles size={15} /></span>
              <div className="message-bubble thinking-bubble">
                <span />
                <span />
                <span />
              </div>
            </article>
          ) : null}
        </div>

        {profiles.length ? (
          <div className="agent-profile-picker">
            <label>
              <span>分析人物档案</span>
              <select
                onChange={(event) => setActiveProfileId(event.target.value)}
                value={activeProfileId}
              >
                <option value="">自动识别 / 未指定</option>
                {profiles.map((profile) => (
                  <option key={profile.profile_id} value={profile.profile_id}>
                    {profile.name} · {profile.relation || "其他"}
                  </option>
                ))}
              </select>
            </label>
            <small>提问中出现姓名时会优先匹配对应人物档案。</small>
          </div>
        ) : null}

        <div className="quick-prompts">
          {quickPrompts.map((prompt) => (
            <button key={prompt} onClick={() => sendMessage(prompt)} type="button">
              {prompt}
            </button>
          ))}
        </div>

        <form className="agent-composer" onSubmit={submit}>
          <label>
            <span className="sr-only">向知命智库提问</span>
            <textarea
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(draft);
                }
              }}
              placeholder="询问典籍、灵签、易卦、八字或个人资料……"
              rows={2}
              value={draft}
            />
          </label>
          <button aria-label="发送问题" disabled={!draft.trim() || thinking} title="发送" type="submit">
            <Send size={18} />
          </button>
        </form>
      </div>

      <aside className="agent-context">
        <section>
          <p className="kicker">LIBRARY SNAPSHOT</p>
          <h3>你的知识库</h3>
          <div className="agent-stats">
            <div><BookOpen size={16} /><strong>{collections.length}</strong><span>收藏</span></div>
            <div><NotebookPen size={16} /><strong>{notes.length}</strong><span>笔记</span></div>
            <div><Tags size={16} /><strong>{tags.length}</strong><span>标签</span></div>
          </div>
        </section>
        <section className="agent-actions">
          <p className="kicker">QUICK ACTIONS</p>
          <button onClick={onAddCollection} type="button">
            <Plus size={15} /> 收藏一条来源
          </button>
          <button onClick={onAddNote} type="button">
            <FileText size={15} /> 新建个人笔记
          </button>
        </section>
        <section className="agent-principle">
          <Library size={17} />
          <p>回答会先定位人物档案，再结合命盘、签卦、收藏与笔记形成分析，并保留对应 <code>source_id</code>。</p>
        </section>
      </aside>
    </section>
  );
}
