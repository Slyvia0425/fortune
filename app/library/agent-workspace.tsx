"use client";

import {
  Bookmark,
  Database,
  Download,
  ExternalLink,
  FileText,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import KnowledgeAgent from "./knowledge-agent";
import { Module4ApiError, module4Api } from "@/lib/module4/api";
import type {
  CollectionDraft,
  CollectionItem,
  NoteDraft,
  NoteItem,
  PrivacySettings,
  TagItem,
} from "@/lib/module4/types";
import type { AuthUser } from "@/lib/auth/types";

type TabId = "all" | "sources" | "readings" | "notes";

const emptyCollectionDraft: CollectionDraft = {
  itemType: "knowledge_item",
  sourceId: "",
  title: "",
  sourceUrl: "",
};

const emptyNoteDraft: NoteDraft = {
  title: "",
  body: "",
  tags: "",
  sourceId: "",
  collectionId: "",
};

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "all", label: "全部收藏" },
  { id: "sources", label: "典籍原文" },
  { id: "readings", label: "卦象签文" },
  { id: "notes", label: "个人笔记" },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function sourceUrl(item: CollectionItem): string | null {
  const value = item.source_metadata?.url;
  return typeof value === "string" && value.trim() ? value : null;
}

function itemTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    knowledge_item: "典籍",
    divination: "卦象",
    sign: "签文",
    personal_note: "笔记",
  };
  return labels[value] || value;
}

function messageFrom(error: unknown): string {
  if (error instanceof Module4ApiError) {
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : "请求失败";
}

export default function LibraryWorkspace({ user }: { user: AuthUser }) {
  const activeUser = user.id;
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [tagItems, setTagItems] = useState<TagItem[]>([]);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCollectionForm, setShowCollectionForm] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [collectionDraft, setCollectionDraft] =
    useState<CollectionDraft>(emptyCollectionDraft);
  const [noteDraft, setNoteDraft] = useState<NoteDraft>(emptyNoteDraft);
  const [tagName, setTagName] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [nextCollections, nextNotes, nextTags, nextPrivacy] = await Promise.all([
          module4Api.listCollections(activeUser),
          module4Api.listNotes(activeUser),
          module4Api.listTags(activeUser),
          module4Api.getPrivacy(activeUser),
        ]);
        if (!cancelled) {
          setCollections(nextCollections);
          setNotes(nextNotes);
          setTagItems(nextTags);
          setPrivacy(nextPrivacy);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(messageFrom(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeUser, reloadKey]);

  const filteredCollections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return collections.filter((item) => {
      const tabMatch =
        activeTab === "all" ||
        activeTab === "sources" ||
        (activeTab === "readings" && ["divination", "sign", "hexagram"].includes(item.item_type));
      if (!tabMatch) return false;
      if (!normalizedQuery) return true;
      return [item.title, item.source_id, item.item_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [activeTab, collections, query]);

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return notes.filter((note) => {
      if (activeTab === "all" || activeTab === "notes") {
        if (!normalizedQuery) return true;
        return [note.title, note.body, note.source_id, ...note.tags]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      }
      return false;
    });
  }, [activeTab, notes, query]);

  const hasVisibleItems = filteredCollections.length + filteredNotes.length > 0;

  async function refreshPersonalData(successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const [nextCollections, nextNotes, nextTags, nextPrivacy] = await Promise.all([
        module4Api.listCollections(activeUser),
        module4Api.listNotes(activeUser),
        module4Api.listTags(activeUser),
        module4Api.getPrivacy(activeUser),
      ]);
      setCollections(nextCollections);
      setNotes(nextNotes);
      setTagItems(nextTags);
      setPrivacy(nextPrivacy);
      setNotice(successMessage);
    } catch (refreshError) {
      setError(messageFrom(refreshError));
    } finally {
      setBusy(false);
    }
  }

  async function submitCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await module4Api.createCollection(activeUser, collectionDraft);
      setCollectionDraft(emptyCollectionDraft);
      setShowCollectionForm(false);
      await refreshPersonalData("收藏已保存");
    } catch (submitError) {
      setError(messageFrom(submitError));
      setBusy(false);
    }
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await module4Api.saveNote(activeUser, noteDraft);
      setNoteDraft(emptyNoteDraft);
      setShowNoteForm(false);
      await refreshPersonalData("笔记已保存");
    } catch (submitError) {
      setError(messageFrom(submitError));
      setBusy(false);
    }
  }

  async function removeCollection(item: CollectionItem) {
    if (!window.confirm(`删除收藏“${item.title || item.source_id}”？`)) return;
    setBusy(true);
    try {
      await module4Api.deleteCollection(activeUser, item.collection_id);
      await refreshPersonalData("收藏已删除");
    } catch (deleteError) {
      setError(messageFrom(deleteError));
      setBusy(false);
    }
  }

  async function removeNote(note: NoteItem) {
    if (!window.confirm(`删除笔记“${note.title || "未命名笔记"}”？`)) return;
    setBusy(true);
    try {
      await module4Api.deleteNote(activeUser, note.note_id);
      await refreshPersonalData("笔记已删除");
    } catch (deleteError) {
      setError(messageFrom(deleteError));
      setBusy(false);
    }
  }

  async function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tagName.trim()) return;
    setBusy(true);
    try {
      await module4Api.createTag(activeUser, tagName.trim());
      setTagName("");
      await refreshPersonalData("标签已创建");
    } catch (tagError) {
      setError(messageFrom(tagError));
      setBusy(false);
    }
  }

  async function removeTag(tag: TagItem) {
    setBusy(true);
    try {
      await module4Api.deleteTag(activeUser, tag.tag_id);
      await refreshPersonalData("标签已删除");
    } catch (tagError) {
      setError(messageFrom(tagError));
      setBusy(false);
    }
  }

  async function savePrivacy(nextPrivacy: PrivacySettings) {
    setPrivacy(nextPrivacy);
    setBusy(true);
    try {
      await module4Api.updatePrivacy(activeUser, nextPrivacy);
      setNotice("隐私设置已更新");
    } catch (privacyError) {
      setError(messageFrom(privacyError));
    } finally {
      setBusy(false);
    }
  }

  async function exportData() {
    setBusy(true);
    setError(null);
    try {
      const job = await module4Api.exportData(activeUser);
      const blob = new Blob([JSON.stringify(job.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `module4-export-${job.export_id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("个人数据已导出");
    } catch (exportError) {
      setError(messageFrom(exportError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllData() {
    const confirmed = window.confirm(
      "此操作会删除当前用户的收藏、笔记、标签、会话与反馈，且无法撤销。继续吗？",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await module4Api.deleteAllData(activeUser);
      setNotice(`已删除 ${Object.values(result.deleted_counts).reduce((a, b) => a + b, 0)} 条数据`);
      setCollections([]);
      setNotes([]);
      setTagItems([]);
    } catch (deleteError) {
      setError(messageFrom(deleteError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="subpage">
      <section className="page-hero">
        <div className="page-shell">
          <p className="crumb">
            <Link href="/">首页</Link> ／ 个人知识库
          </p>
          <p className="kicker">PERSONAL KNOWLEDGE BASE</p>
          <h1 className="page-title">与你的知识库对话</h1>
          <p>收藏典籍段落、卦象、签文与个人笔记，再通过知识库智能体检索原文、上下文和来源。</p>
        </div>
      </section>

      <nav className="module4-nav" aria-label="个人知识库模块导航">
        <div className="page-shell">
          <a href="#agent">知识助手</a>
          <a href="#collections">我的藏书</a>
          <a href="#notes">知识笔记</a>
          <a href="#tags">标签</a>
          <a href="#privacy">数据隐私</a>
        </div>
      </nav>

      <KnowledgeAgent
        collections={collections}
        loading={loading}
        notes={notes}
        onAddCollection={() => setShowCollectionForm(true)}
        onAddNote={() => setShowNoteForm(true)}
        tags={tagItems}
        userId={activeUser}
      />

      <section className="page-shell library-shell" id="collections">
        <div className="library-main">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="收藏筛选">
              {tabs.map((tab) => (
                <button
                  aria-selected={activeTab === tab.id}
                  className={`tab ${activeTab === tab.id ? "active" : ""}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <button
                className="button button-secondary"
                onClick={() => setShowCollectionForm(true)}
                type="button"
              >
                <Plus size={15} /> 收藏来源
              </button>
              <button
                className="button button-primary"
                onClick={() => setShowNoteForm(true)}
                type="button"
              >
                <NotebookPen size={15} /> 新建笔记
              </button>
            </div>
          </div>

          <div className="summary-strip">
            <div>
              <strong>{collections.length}</strong>
              <span>收藏来源</span>
            </div>
            <div>
              <strong>{notes.length}</strong>
              <span>个人笔记</span>
            </div>
            <div>
              <strong>{tagItems.length}</strong>
              <span>个人标签</span>
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="搜索收藏和笔记"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、正文或来源"
                value={query}
              />
            </label>
          </div>

          {error ? (
            <div className="notice notice-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setReloadKey((value) => value + 1)} type="button">
                <RefreshCw size={14} /> 重试
              </button>
            </div>
          ) : null}
          {notice ? <div className="notice notice-success">{notice}</div> : null}

          {loading ? (
            <div className="panel empty-state">
              <p className="kicker">正在读取</p>
              <h2>载入个人知识库</h2>
            </div>
          ) : activeTab === "notes" && filteredNotes.length === 0 ? (
            <div className="panel empty-state" id="notes">
              <p className="kicker">尚无笔记</p>
              <h2>把思考留在原文旁边</h2>
              <p>新建的笔记会保留来源标识与标签，并可在个人知识库中检索。</p>
            </div>
          ) : !hasVisibleItems ? (
            <div className="panel empty-state">
              <p className="kicker">尚无收藏</p>
              <h2>把值得再读的内容收在这里</h2>
              <p>收藏内容会保留其来源链接与上下文。</p>
            </div>
          ) : (
            <div className="saved-grid">
              {filteredCollections.map((item) => (
                <article className="saved-item" key={item.collection_id}>
                  <div className="saved-icon">
                    {item.item_type === "knowledge_item" ? (
                      <Bookmark size={19} />
                    ) : (
                      <FileText size={19} />
                    )}
                  </div>
                  <div className="saved-body">
                    <div className="saved-meta">
                      <span>{itemTypeLabel(item.item_type)}</span>
                      <time>{formatDate(item.created_at)}</time>
                    </div>
                    <h2>{item.title || item.source_id || "未命名收藏"}</h2>
                    <p>{item.source_id || item.snapshot_id}</p>
                    <div className="saved-actions">
                      {sourceUrl(item) ? (
                        <a href={sourceUrl(item) || "#"} rel="noreferrer" target="_blank">
                          <ExternalLink size={14} /> 查看来源
                        </a>
                      ) : null}
                      <button
                        aria-label="删除收藏"
                        onClick={() => void removeCollection(item)}
                        title="删除收藏"
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}

              {filteredNotes.map((note) => (
                <article className="saved-item note-item" id="notes" key={note.note_id}>
                  <div className="saved-icon">
                    <NotebookPen size={19} />
                  </div>
                  <div className="saved-body">
                    <div className="saved-meta">
                      <span>个人笔记</span>
                      <time>{formatDate(note.updated_at)}</time>
                    </div>
                    <h2>{note.title || "未命名笔记"}</h2>
                    <p className="note-body">{note.body}</p>
                    <div className="tag-list">
                      {note.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className="saved-actions">
                      {note.source_id ? <small>来源 {note.source_id}</small> : null}
                      <button
                        aria-label="编辑笔记"
                        onClick={() => {
                          setNoteDraft({
                            noteId: note.note_id,
                            title: note.title || "",
                            body: note.body,
                            tags: note.tags.join(", "),
                            sourceId: note.source_id || "",
                            collectionId: note.collection_id || "",
                          });
                          setShowNoteForm(true);
                        }}
                        title="编辑笔记"
                        type="button"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        aria-label="删除笔记"
                        onClick={() => void removeNote(note)}
                        title="删除笔记"
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="library-aside">
          <section className="panel aside-panel" id="tags">
            <div className="panel-heading">
              <span className="panel-icon"><Tags size={17} /></span>
              <div>
                <p className="kicker">TAGS</p>
                <h2>个人标签</h2>
              </div>
            </div>
            <form className="inline-form" onSubmit={addTag}>
              <input
                aria-label="新标签名称"
                onChange={(event) => setTagName(event.target.value)}
                placeholder="输入标签"
                value={tagName}
              />
              <button aria-label="添加标签" disabled={busy} title="添加标签" type="submit">
                <Plus size={15} />
              </button>
            </form>
            <div className="tag-list tag-list-stacked">
              {tagItems.length ? (
                tagItems.map((tag) => (
                  <span key={tag.tag_id}>
                    {tag.name}
                    <button
                      aria-label={`删除标签 ${tag.name}`}
                      onClick={() => void removeTag(tag)}
                      title="删除标签"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              ) : (
                <p className="aside-empty">暂无标签</p>
              )}
            </div>
          </section>

          <section className="panel aside-panel" id="privacy">
            <div className="panel-heading">
              <span className="panel-icon"><ShieldCheck size={17} /></span>
              <div>
                <p className="kicker">PRIVACY</p>
                <h2>数据与隐私</h2>
              </div>
            </div>
            <div className="identity-form">
              <label>当前账户</label>
              <strong>{user.display_name}</strong>
              <small>{user.email}</small>
            </div>
            {privacy ? (
              <div className="privacy-options">
                <label className="switch-row">
                  <span>
                    <b>匿名案例</b>
                    <small>允许去标识化案例进入相似匹配</small>
                  </span>
                  <input
                    checked={privacy.allow_anonymous_cases}
                    onChange={(event) =>
                      void savePrivacy({
                        ...privacy,
                        allow_anonymous_cases: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                </label>
                <label className="switch-row">
                  <span>
                    <b>共享训练</b>
                    <small>允许用于模型质量改进</small>
                  </span>
                  <input
                    checked={privacy.allow_shared_training}
                    onChange={(event) =>
                      void savePrivacy({
                        ...privacy,
                        allow_shared_training: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                </label>
                <label className="field compact-field">
                  保留期限
                  <select
                    onChange={(event) =>
                      void savePrivacy({ ...privacy, retention_policy: event.target.value })
                    }
                    value={privacy.retention_policy}
                  >
                    <option value="standard">标准</option>
                    <option value="30_days">30 天</option>
                    <option value="90_days">90 天</option>
                    <option value="indefinite">长期保留</option>
                  </select>
                </label>
              </div>
            ) : null}
            <div className="data-actions">
              <button disabled={busy} onClick={() => void exportData()} type="button">
                <Download size={15} /> 导出数据
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void deleteAllData()}
                type="button"
              >
                <Trash2 size={15} /> 删除全部
              </button>
            </div>
          </section>

          <section className="source-note">
            <Database size={17} />
            <p>来源统一使用 <code>source_id</code> 关联，个人笔记不会改写公共知识内容。</p>
          </section>
        </aside>
      </section>

      {showCollectionForm ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="collection-form-title" aria-modal="true" className="modal" role="dialog">
            <div className="modal-heading">
              <div>
                <p className="kicker">SAVE SOURCE</p>
                <h2 id="collection-form-title">收藏来源</h2>
              </div>
              <button
                aria-label="关闭收藏表单"
                onClick={() => setShowCollectionForm(false)}
                title="关闭"
                type="button"
              >
                <X size={19} />
              </button>
            </div>
            <form className="form-grid" onSubmit={submitCollection}>
              <label className="field full">
                标题
                <input
                  onChange={(event) =>
                    setCollectionDraft({ ...collectionDraft, title: event.target.value })
                  }
                  placeholder="例如：穷通宝鉴 · 论甲木"
                  value={collectionDraft.title}
                />
              </label>
              <label className="field">
                类型
                <select
                  onChange={(event) =>
                    setCollectionDraft({ ...collectionDraft, itemType: event.target.value })
                  }
                  value={collectionDraft.itemType}
                >
                  <option value="knowledge_item">典籍原文</option>
                  <option value="divination">卦象</option>
                  <option value="sign">签文</option>
                </select>
              </label>
              <label className="field">
                source_id
                <input
                  onChange={(event) =>
                    setCollectionDraft({ ...collectionDraft, sourceId: event.target.value })
                  }
                  placeholder="必填"
                  required
                  value={collectionDraft.sourceId}
                />
              </label>
              <label className="field full">
                来源链接
                <input
                  onChange={(event) =>
                    setCollectionDraft({ ...collectionDraft, sourceUrl: event.target.value })
                  }
                  placeholder="https://..."
                  type="url"
                  value={collectionDraft.sourceUrl}
                />
              </label>
              <div className="form-actions full">
                <button
                  className="button button-secondary"
                  onClick={() => setShowCollectionForm(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  <Save size={15} /> 保存收藏
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showNoteForm ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="note-form-title" aria-modal="true" className="modal" role="dialog">
            <div className="modal-heading">
              <div>
                <p className="kicker">PERSONAL NOTE</p>
                <h2 id="note-form-title">{noteDraft.noteId ? "编辑笔记" : "新建笔记"}</h2>
              </div>
              <button
                aria-label="关闭笔记表单"
                onClick={() => {
                  setShowNoteForm(false);
                  setNoteDraft(emptyNoteDraft);
                }}
                title="关闭"
                type="button"
              >
                <X size={19} />
              </button>
            </div>
            <form className="form-grid" onSubmit={submitNote}>
              <label className="field full">
                标题
                <input
                  onChange={(event) => setNoteDraft({ ...noteDraft, title: event.target.value })}
                  placeholder="笔记标题"
                  value={noteDraft.title}
                />
              </label>
              <label className="field full">
                内容
                <textarea
                  onChange={(event) => setNoteDraft({ ...noteDraft, body: event.target.value })}
                  placeholder="记录你的理解、疑问与出处"
                  required
                  rows={7}
                  value={noteDraft.body}
                />
              </label>
              <label className="field">
                标签
                <input
                  onChange={(event) => setNoteDraft({ ...noteDraft, tags: event.target.value })}
                  placeholder="用英文逗号分隔"
                  value={noteDraft.tags}
                />
              </label>
              <label className="field">
                source_id
                <input
                  onChange={(event) =>
                    setNoteDraft({ ...noteDraft, sourceId: event.target.value })
                  }
                  placeholder="可选"
                  value={noteDraft.sourceId}
                />
              </label>
              <label className="field full">
                关联收藏
                <select
                  onChange={(event) =>
                    setNoteDraft({ ...noteDraft, collectionId: event.target.value })
                  }
                  value={noteDraft.collectionId}
                >
                  <option value="">不关联</option>
                  {collections.map((item) => (
                    <option key={item.collection_id} value={item.collection_id}>
                      {item.title || item.source_id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions full">
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setShowNoteForm(false);
                    setNoteDraft(emptyNoteDraft);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  <Save size={15} /> 保存笔记
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
