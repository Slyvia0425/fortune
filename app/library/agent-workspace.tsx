"use client";

import {
  Bookmark,
  Check,
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
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import KnowledgeAgent from "./knowledge-agent";
import { Module4ApiError, module4Api } from "@/lib/module4/api";
import type {
  CollectionDraft,
  CollectionItem,
  NoteDraft,
  NoteItem,
  PersonProfile,
  PrivacySettings,
  TagItem,
} from "@/lib/module4/types";
import type { AuthUser } from "@/lib/auth/types";

type TabId = "all" | "sources" | "readings" | "notes" | "profiles";

const emptyCollectionDraft: CollectionDraft = {
  itemType: "knowledge_item",
  sourceId: "",
  title: "",
  sourceUrl: "",
  category: "knowledge",
  tags: "",
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
  { id: "readings", label: "术数记录" },
  { id: "notes", label: "个人笔记" },
  { id: "profiles", label: "人物档案" },
];

const categoryOptions: Array<{ value: string; label: string }> = [
  { value: "all", label: "全部分类" },
  { value: "knowledge", label: "典籍" },
  { value: "bazi", label: "八字" },
  { value: "divination", label: "易卦" },
  { value: "guanyin", label: "灵签" },
  { value: "manual", label: "手动收藏" },
  { value: "other", label: "其他" },
];

const profileRelationOptions = ["本人", "家人", "亲友", "客户", "研究案例", "其他"];

const profileStemLabels: Record<string, string> = {
  jia: "甲",
  yi: "乙",
  bing: "丙",
  ding: "丁",
  wu: "戊",
  ji: "己",
  geng: "庚",
  xin: "辛",
  ren: "壬",
  gui: "癸",
};

const profileBranchLabels: Record<string, string> = {
  zi: "子",
  chou: "丑",
  yin: "寅",
  mao: "卯",
  chen: "辰",
  si: "巳",
  wu_branch: "午",
  wei: "未",
  shen: "申",
  you: "酉",
  xu: "戌",
  hai: "亥",
};

const profileElementLabels: Record<string, string> = {
  wood: "木",
  fire: "火",
  earth: "土",
  metal: "金",
  water: "水",
};

const profileStrengthLabels: Record<string, string> = {
  very_strong: "明显偏强",
  strong: "偏强",
  balanced: "相对平衡",
  weak: "偏弱",
  somewhat_weak: "偏弱",
  very_weak: "明显偏弱",
};

function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
}

function categoryOf(item: CollectionItem): string {
  const metadataCategory = item.source_metadata?.category;
  const metadataModule = item.source_metadata?.module;
  if (typeof item.category === "string" && item.category.trim()) return item.category.trim();
  if (typeof metadataCategory === "string" && metadataCategory.trim()) {
    return metadataCategory.trim();
  }
  if (typeof metadataModule === "string" && metadataModule.trim()) return metadataModule.trim();
  return "other";
}

function categoryLabel(value: string): string {
  return categoryOptions.find((option) => option.value === value)?.label ?? value;
}

function tagsOf(item: CollectionItem): string[] {
  if (item.tags?.length) return item.tags;
  const raw = item.source_metadata?.tags;
  return Array.isArray(raw) ? raw.map((tag) => String(tag)) : [];
}

function collectionSummary(item: CollectionItem): string {
  const summary = item.source_metadata?.summary;
  return typeof summary === "string" ? summary : "";
}

function isSourceItemType(value: string): boolean {
  return value === "knowledge_item" || value.startsWith("knowledge_");
}

function isReadingItemType(value: string): boolean {
  return (
    value.startsWith("divination") ||
    value.startsWith("sign") ||
    value.startsWith("bazi") ||
    ["divination", "sign", "hexagram"].includes(value)
  );
}

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
    knowledge_search: "典籍检索",
    knowledge_reading: "典籍原文",
    divination: "卦象",
    sign: "签文",
    personal_note: "笔记",
    divination_question: "问卦所问",
    divination_record: "卦象记录",
    divination_reading: "卦辞依据",
    divination_chat: "问卦对话",
    sign_question: "求签所问",
    sign_record: "灵签签文",
    bazi_input: "出生信息",
    bazi_record: "八字命盘",
    bazi_analysis: "五行十神",
    bazi_luck: "大运流年",
    bazi_advisory: "方向依据",
  };
  return labels[value] || value;
}

function profilePillars(profile: PersonProfile): string {
  const pillars = profile.chart_snapshot?.pillars;
  if (!Array.isArray(pillars)) return "尚未保存完整命盘";
  return pillars
    .map((pillar) => {
      if (!pillar || typeof pillar !== "object") return "";
      const item = pillar as Record<string, unknown>;
      const stem = String(item.stem || "");
      const branch = String(item.branch || "");
      return `${profileStemLabels[stem] || stem}${profileBranchLabels[branch] || branch}`;
    })
    .filter(Boolean)
    .join(" ");
}

function profileChartNote(profile: PersonProfile): string {
  const elements = profile.chart_snapshot?.elements;
  const dayMaster = profile.chart_snapshot?.day_master;
  const elementText =
    elements && typeof elements === "object"
      ? Object.entries(elements as Record<string, unknown>)
          .slice(0, 5)
          .map(([key, value]) => `${profileElementLabels[key] || key} ${value}`)
          .join(" · ")
      : "";
  const dayMasterRecord =
    dayMaster && typeof dayMaster === "object"
      ? (dayMaster as Record<string, unknown>)
      : {};
  const dayMasterStem = String(dayMasterRecord.stem || "");
  const dayMasterElement = String(dayMasterRecord.element || "");
  const dayMasterText = `${
    profileStemLabels[dayMasterStem] || dayMasterStem
  }${profileElementLabels[dayMasterElement] || dayMasterElement}`;
  const strength =
    typeof dayMasterRecord.strength === "string" ? dayMasterRecord.strength : "";
  const strengthLabel = profileStrengthLabels[strength] || strength;
  return (
    [dayMasterText, strengthLabel, elementText].filter(Boolean).join(" · ") ||
    "档案已建立，等待完整命盘记录。"
  );
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
  const [profiles, setProfiles] = useState<PersonProfile[]>([]);
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
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [collectionEdit, setCollectionEdit] = useState<CollectionItem | null>(null);
  const [editCategory, setEditCategory] = useState("knowledge");
  const [editTags, setEditTags] = useState("");
  const [renamingTagId, setRenamingTagId] = useState<string | null>(null);
  const [tagRenameDraft, setTagRenameDraft] = useState("");
  const [profileEdit, setProfileEdit] = useState<PersonProfile | null>(null);
  const [profileEditName, setProfileEditName] = useState("");
  const [profileEditRelation, setProfileEditRelation] = useState("其他");
  const [profileEditTags, setProfileEditTags] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [nextCollections, nextNotes, nextTags, nextPrivacy, nextProfiles] = await Promise.all([
          module4Api.listCollections(activeUser),
          module4Api.listNotes(activeUser),
          module4Api.listTags(activeUser),
          module4Api.getPrivacy(activeUser),
          module4Api.listPersonProfiles(activeUser),
        ]);
        if (!cancelled) {
          setCollections(nextCollections);
          setNotes(nextNotes);
          setTagItems(nextTags);
          setPrivacy(nextPrivacy);
          setProfiles(nextProfiles);
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
        (activeTab === "sources" && isSourceItemType(item.item_type)) ||
        (activeTab === "readings" && isReadingItemType(item.item_type));
      if (!tabMatch) return false;
      if (activeCategory !== "all" && categoryOf(item) !== activeCategory) return false;
      if (activeTagFilter && !tagsOf(item).includes(activeTagFilter)) return false;
      if (!normalizedQuery) return true;
      return [
        item.title,
        item.source_id,
        item.item_type,
        categoryLabel(categoryOf(item)),
        collectionSummary(item),
        ...tagsOf(item),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [activeCategory, activeTab, activeTagFilter, collections, query]);

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return notes.filter((note) => {
      if (activeTab === "all" || activeTab === "notes") {
        if (activeTagFilter && !note.tags.includes(activeTagFilter)) return false;
        if (!normalizedQuery) return true;
        return [note.title, note.body, note.source_id, ...note.tags]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      }
      return false;
    });
  }, [activeTab, activeTagFilter, notes, query]);

  const filteredProfiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return profiles.filter((profile) => {
      if (activeTagFilter && !profile.tags.includes(activeTagFilter)) return false;
      if (!normalizedQuery) return true;
      return [
        profile.name,
        profile.relation,
        profile.birth_date,
        profile.birth_time,
        profilePillars(profile),
        profileChartNote(profile),
        ...profile.tags,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [activeTagFilter, profiles, query]);

  const profileRecordCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of collections) {
      const metadata = item.source_metadata || {};
      const profileId = typeof metadata.profile_id === "string" ? metadata.profile_id : "";
      const personName = typeof metadata.person_name === "string" ? metadata.person_name : "";
      if (profileId) counts.set(profileId, (counts.get(profileId) ?? 0) + 1);
      if (personName) counts.set(personName, (counts.get(personName) ?? 0) + 1);
    }
    return counts;
  }, [collections]);

  const tagUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of collections) {
      for (const tag of tagsOf(item)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    for (const note of notes) {
      for (const tag of note.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return counts;
  }, [collections, notes]);

  const tagRows = useMemo(() => {
    const rows = new Map<string, TagItem>();
    for (const tag of tagItems) rows.set(tag.name, tag);
    for (const [name, count] of tagUsage) {
      if (!rows.has(name)) {
        rows.set(name, {
          tag_id: `local:${name}`,
          name,
          usage_count: count,
          created_at: "",
        });
      }
    }
    return [...rows.values()].sort(
      (left, right) =>
        (tagUsage.get(right.name) ?? right.usage_count ?? 0) -
          (tagUsage.get(left.name) ?? left.usage_count ?? 0) ||
        left.name.localeCompare(right.name),
    );
  }, [tagItems, tagUsage]);

  const hasVisibleItems =
    filteredCollections.length + filteredNotes.length + filteredProfiles.length > 0;

  async function refreshPersonalData(successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const [nextCollections, nextNotes, nextTags, nextPrivacy, nextProfiles] = await Promise.all([
        module4Api.listCollections(activeUser),
        module4Api.listNotes(activeUser),
        module4Api.listTags(activeUser),
        module4Api.getPrivacy(activeUser),
        module4Api.listPersonProfiles(activeUser),
      ]);
      setCollections(nextCollections);
      setNotes(nextNotes);
      setTagItems(nextTags);
      setPrivacy(nextPrivacy);
      setProfiles(nextProfiles);
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

  function openCollectionEditor(item: CollectionItem) {
    setCollectionEdit(item);
    setEditCategory(categoryOf(item));
    setEditTags(tagsOf(item).join(", "));
  }

  async function submitCollectionEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collectionEdit) return;
    setBusy(true);
    setError(null);
    try {
      await module4Api.updateCollection(activeUser, collectionEdit.collection_id, {
        category: editCategory,
        tags: parseTags(editTags),
      });
      setCollectionEdit(null);
      await refreshPersonalData("分类与标签已更新");
    } catch (updateError) {
      setError(messageFrom(updateError));
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

  function startTagRename(tag: TagItem) {
    setRenamingTagId(tag.tag_id);
    setTagRenameDraft(tag.name);
  }

  async function submitTagRename(event: FormEvent<HTMLFormElement>, tag: TagItem) {
    event.preventDefault();
    const nextName = tagRenameDraft.trim();
    if (!nextName || nextName === tag.name) {
      setRenamingTagId(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await module4Api.renameTag(activeUser, tag.tag_id, nextName);
      if (activeTagFilter === tag.name) {
        setActiveTagFilter(nextName);
      }
      setRenamingTagId(null);
      await refreshPersonalData("标签已重命名");
    } catch (renameError) {
      setError(messageFrom(renameError));
      setBusy(false);
    }
  }

  async function removeTag(tag: TagItem) {
    const usage = tagUsage.get(tag.name) ?? tag.usage_count ?? 0;
    const confirmed = window.confirm(
      `删除标签“${tag.name}”？它会从 ${usage} 条收藏或笔记中移除，公共资料不受影响。`,
    );
    if (!confirmed) return;
    if (tag.tag_id.startsWith("local:")) {
      setError("该标签尚未写入标签库，请先在对应收藏或笔记中移除。");
      return;
    }
    setBusy(true);
    try {
      await module4Api.deleteTag(activeUser, tag.tag_id);
      if (activeTagFilter === tag.name) {
        setActiveTagFilter(null);
      }
      await refreshPersonalData("标签已删除");
    } catch (tagError) {
      setError(messageFrom(tagError));
      setBusy(false);
    }
  }

  function openProfileEditor(profile: PersonProfile) {
    setProfileEdit(profile);
    setProfileEditName(profile.name);
    setProfileEditRelation(profile.relation || "其他");
    setProfileEditTags(profile.tags.join(", "));
  }

  async function submitProfileEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileEdit) return;
    setBusy(true);
    setError(null);
    try {
      await module4Api.updatePersonProfile(activeUser, profileEdit.profile_id, {
        name: profileEditName,
        relation: profileEditRelation,
        tags: parseTags(profileEditTags),
      });
      setProfileEdit(null);
      await refreshPersonalData("人物档案已更新");
    } catch (profileError) {
      setError(messageFrom(profileError));
      setBusy(false);
    }
  }

  async function removeProfile(profile: PersonProfile) {
    const confirmed = window.confirm(
      `删除人物档案“${profile.name}”？只删除档案名称和命盘摘要，不删除已保存的收藏记录。`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await module4Api.deletePersonProfile(activeUser, profile.profile_id);
      if (profileEdit?.profile_id === profile.profile_id) setProfileEdit(null);
      await refreshPersonalData("人物档案已删除");
    } catch (profileError) {
      setError(messageFrom(profileError));
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
      setProfiles([]);
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
            <Link href="/">首页</Link> ／ 知命智库
          </p>
          <p className="kicker">FORTUNE KNOWLEDGE HUB</p>
          <h1 className="page-title">知命智库</h1>
          <p>统一检索典籍、灵签、易卦、八字与个人收藏，在保留来源标识的前提下完成跨模块问答。</p>
        </div>
      </section>

      <nav className="module4-nav" aria-label="知命智库模块导航">
        <div className="page-shell">
          <a href="#agent">知识助手</a>
          <a href="#profiles">人物档案</a>
          <a href="#collections">个人收藏</a>
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
        profiles={profiles}
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
              {activeTab === "profiles" ? (
                <Link className="button button-primary" href="/bazi">
                  <Users size={15} /> 前往八字建立档案
                </Link>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>

          {activeTab !== "profiles" ? <div className="filter-bar">
            <label>
              <span>分类</span>
              <select
                aria-label="按分类筛选"
                onChange={(event) => setActiveCategory(event.target.value)}
                value={activeCategory}
              >
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {activeTagFilter ? (
              <button
                className="active-filter"
                onClick={() => setActiveTagFilter(null)}
                type="button"
              >
                标签：{activeTagFilter} <X size={12} />
              </button>
            ) : (
              <span className="filter-hint">点击收藏或笔记上的标签即可筛选</span>
            )}
            {activeCategory !== "all" || activeTagFilter ? (
              <button
                className="text-button"
                onClick={() => {
                  setActiveCategory("all");
                  setActiveTagFilter(null);
                }}
                type="button"
              >
                清除筛选
              </button>
            ) : null}
          </div> : null}

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
            <div>
              <strong>{profiles.length}</strong>
              <span>人物档案</span>
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="搜索收藏和笔记"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={activeTab === "profiles" ? "搜索人物、分类或命盘" : "搜索标题、正文或来源"}
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
              <h2>载入个人收藏</h2>
            </div>
          ) : activeTab === "profiles" && filteredProfiles.length === 0 ? (
            <div className="panel empty-state" id="profiles">
              <p className="kicker">尚无人物档案</p>
              <h2>为不同的命盘建立独立人物名称</h2>
              <p>在八字页面填写人物名称并生成命盘后，姓名、分类、出生信息和完整命盘会保存在这里。</p>
            </div>
          ) : activeTab === "profiles" ? (
            <div className="saved-grid" id="profiles">
              {filteredProfiles.map((profile) => (
                <article className="saved-item profile-item" key={profile.profile_id}>
                  <div className="saved-icon">
                    <Users size={19} />
                  </div>
                  <div className="saved-body">
                    <div className="saved-meta">
                      <span className="category-badge">{profile.relation || "其他"}</span>
                      <span>人物档案</span>
                      <time>{formatDate(profile.updated_at)}</time>
                    </div>
                    <h2>{profile.name}</h2>
                    <p className="item-summary">
                      {profile.birth_date || "未记录日期"} {profile.birth_time || ""} ·{" "}
                      {profile.calendar === "lunar" ? "农历" : "公历"} · 关联{" "}
                      {profileRecordCounts.get(profile.profile_id) ??
                        profileRecordCounts.get(profile.name) ??
                        0}{" "}
                      条记录
                    </p>
                    <p className="profile-pillars">{profilePillars(profile)}</p>
                    <p className="profile-chart-note">{profileChartNote(profile)}</p>
                    {profile.tags.length ? (
                      <div className="tag-list tag-list-filter">
                        {profile.tags.map((tag) => (
                          <button
                            className={activeTagFilter === tag ? "active" : ""}
                            key={tag}
                            onClick={() =>
                              setActiveTagFilter(activeTagFilter === tag ? null : tag)
                            }
                            type="button"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="saved-actions">
                      <button
                        aria-label={`编辑人物档案 ${profile.name}`}
                        onClick={() => openProfileEditor(profile)}
                        title="编辑人物档案"
                        type="button"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        aria-label={`删除人物档案 ${profile.name}`}
                        onClick={() => void removeProfile(profile)}
                        title="删除人物档案"
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : activeTab === "notes" && filteredNotes.length === 0 ? (
            <div className="panel empty-state" id="notes">
              <p className="kicker">尚无笔记</p>
              <h2>把思考留在原文旁边</h2>
              <p>新建的笔记会保留来源标识与标签，并可在知命智库中检索。</p>
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
                    {isSourceItemType(item.item_type) ? (
                      <Bookmark size={19} />
                    ) : (
                      <FileText size={19} />
                    )}
                  </div>
                  <div className="saved-body">
                    <div className="saved-meta">
                      <span className="category-badge">{categoryLabel(categoryOf(item))}</span>
                      <span>{itemTypeLabel(item.item_type)}</span>
                      <time>{formatDate(item.created_at)}</time>
                    </div>
                    <h2>{item.title || item.source_id || "未命名收藏"}</h2>
                    {collectionSummary(item) ? (
                      <p className="item-summary">{collectionSummary(item)}</p>
                    ) : null}
                    <p className="source-link">{item.source_id || item.snapshot_id}</p>
                    {tagsOf(item).length ? (
                      <div className="tag-list tag-list-filter">
                        {tagsOf(item).map((tag) => (
                          <button
                            className={activeTagFilter === tag ? "active" : ""}
                            key={tag}
                            onClick={() =>
                              setActiveTagFilter(activeTagFilter === tag ? null : tag)
                            }
                            type="button"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="tag-empty">未添加标签，可在右侧编辑分类与标签</p>
                    )}
                    <div className="saved-actions">
                      {sourceUrl(item) ? (
                        <a href={sourceUrl(item) || "#"} rel="noreferrer" target="_blank">
                          <ExternalLink size={14} /> 查看来源
                        </a>
                      ) : null}
                      <button
                        aria-label="编辑分类和标签"
                        onClick={() => openCollectionEditor(item)}
                        title="编辑分类和标签"
                        type="button"
                      >
                        <Pencil size={15} />
                      </button>
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
                    {note.tags.length ? (
                      <div className="tag-list tag-list-filter">
                        {note.tags.map((tag) => (
                          <button
                            className={activeTagFilter === tag ? "active" : ""}
                            key={tag}
                            onClick={() =>
                              setActiveTagFilter(activeTagFilter === tag ? null : tag)
                            }
                            type="button"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="tag-empty">未添加标签，可在编辑笔记时填写</p>
                    )}
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
            <p className="tag-help">
              标签在收藏与笔记间同步：点击标签筛选，铅笔重命名，删除会从全部个人内容中移除。
            </p>
            <div className="tag-list tag-list-stacked tag-manager">
              {tagRows.length ? (
                tagRows.map((tag) => (
                  <div className="tag-row" key={tag.tag_id}>
                    {renamingTagId === tag.tag_id ? (
                      <form
                        className="tag-rename"
                        onSubmit={(event) => void submitTagRename(event, tag)}
                      >
                        <input
                          aria-label={`重命名标签 ${tag.name}`}
                          autoFocus
                          onChange={(event) => setTagRenameDraft(event.target.value)}
                          value={tagRenameDraft}
                        />
                        <button aria-label="保存标签名称" title="保存" type="submit">
                          <Check size={12} />
                        </button>
                        <button
                          aria-label="取消重命名"
                          onClick={() => setRenamingTagId(null)}
                          title="取消"
                          type="button"
                        >
                          <X size={12} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          className={
                            activeTagFilter === tag.name ? "tag-filter active" : "tag-filter"
                          }
                          onClick={() =>
                            setActiveTagFilter(activeTagFilter === tag.name ? null : tag.name)
                          }
                          type="button"
                        >
                          {tag.name}
                          <small>{tagUsage.get(tag.name) ?? tag.usage_count ?? 0}</small>
                        </button>
                        <span className="tag-actions">
                          <button
                            aria-label={`重命名标签 ${tag.name}`}
                            disabled={tag.tag_id.startsWith("local:")}
                            onClick={() => startTagRename(tag)}
                            title="重命名"
                            type="button"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            aria-label={`删除标签 ${tag.name}`}
                            onClick={() => void removeTag(tag)}
                            title="删除"
                            type="button"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      </>
                    )}
                  </div>
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
                  <option value="divination_record">卦象记录</option>
                  <option value="sign_record">灵签签文</option>
                  <option value="bazi_record">八字命盘</option>
                </select>
              </label>
              <label className="field">
                分类
                <select
                  onChange={(event) =>
                    setCollectionDraft({ ...collectionDraft, category: event.target.value })
                  }
                  value={collectionDraft.category ?? "knowledge"}
                >
                  {categoryOptions
                    .filter((option) => option.value !== "all")
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
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
              <label className="field full">
                标签
                <input
                  onChange={(event) =>
                    setCollectionDraft({ ...collectionDraft, tags: event.target.value })
                  }
                  placeholder="用逗号分隔，例如：五行, 用神, 重点"
                  value={collectionDraft.tags ?? ""}
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

      {collectionEdit ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="collection-edit-title"
            aria-modal="true"
            className="modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <p className="kicker">CLASSIFY COLLECTION</p>
                <h2 id="collection-edit-title">编辑分类与标签</h2>
              </div>
              <button
                aria-label="关闭编辑窗口"
                onClick={() => setCollectionEdit(null)}
                title="关闭"
                type="button"
              >
                <X size={19} />
              </button>
            </div>
            <p className="panel-intro">
              {collectionEdit.title || collectionEdit.source_id || "未命名收藏"}
            </p>
            <form className="form-grid" onSubmit={submitCollectionEdit}>
              <label className="field full">
                分类
                <select
                  onChange={(event) => setEditCategory(event.target.value)}
                  value={editCategory}
                >
                  {categoryOptions
                    .filter((option) => option.value !== "all")
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field full">
                标签
                <input
                  onChange={(event) => setEditTags(event.target.value)}
                  placeholder="用逗号分隔，例如：五行, 用神, 重点"
                  value={editTags}
                />
              </label>
              <div className="form-actions full">
                <button
                  className="button button-secondary"
                  onClick={() => setCollectionEdit(null)}
                  type="button"
                >
                  取消
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  <Save size={15} /> 保存分类与标签
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {profileEdit ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="profile-edit-title"
            aria-modal="true"
            className="modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <p className="kicker">PERSON PROFILE</p>
                <h2 id="profile-edit-title">编辑人物档案</h2>
              </div>
              <button
                aria-label="关闭人物档案窗口"
                onClick={() => setProfileEdit(null)}
                title="关闭"
                type="button"
              >
                <X size={19} />
              </button>
            </div>
            <p className="panel-intro">
              已保存命盘：{profilePillars(profileEdit)}
            </p>
            <form className="form-grid" onSubmit={submitProfileEdit}>
              <label className="field full">
                人物名称
                <input
                  onChange={(event) => setProfileEditName(event.target.value)}
                  required
                  value={profileEditName}
                />
              </label>
              <label className="field full">
                档案分类
                <select
                  onChange={(event) => setProfileEditRelation(event.target.value)}
                  value={profileEditRelation}
                >
                  {profileRelationOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field full">
                标签
                <input
                  onChange={(event) => setProfileEditTags(event.target.value)}
                  placeholder="用逗号分隔，例如：家人, 事业咨询"
                  value={profileEditTags}
                />
              </label>
              <div className="form-actions full">
                <button
                  className="button button-secondary"
                  onClick={() => setProfileEdit(null)}
                  type="button"
                >
                  取消
                </button>
                <button className="button button-primary" disabled={busy} type="submit">
                  <Save size={15} /> 保存人物档案
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => void removeProfile(profileEdit)}
                  type="button"
                >
                  <Trash2 size={15} /> 删除档案
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
                  placeholder="用逗号分隔，例如：五行, 用神"
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
