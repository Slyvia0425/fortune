"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import CollectionButton from "@/app/components/collection-button";

interface Item {
  id: string;
  title: string;
  source: string;
  catalog: string;
  category: string[];
  excerpt: string;
  url: string;
}

export default function KnowledgeSearch() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  async function go(event: FormEvent) {
    event.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    const response = await fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`);
    const data = await response.json();
    setItems((data.result ?? []) as Item[]);
    setLoading(false);
  }

  return (
    <div className="knowledge-layout">
      <div>
        <form className="search-box" onSubmit={go}>
          <input
            aria-label="知识检索"
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索：五行、十神、卦名、古籍原句……"
            value={q}
          />
          <button>求索</button>
        </form>
        <div className="result-list">
          {loading ? (
            <div className="empty-state">正在检索典籍……</div>
          ) : items.length ? (
            items.map((x) => (
              <article className="result-item" key={x.id}>
                <Link href={`/knowledge/${x.id}`}>
                  <span className="result-meta">
                    {x.source} · {x.category.join(" / ")}
                  </span>
                  <h3>{x.title}</h3>
                  <p>{x.excerpt}</p>
                  <small>{x.catalog}</small>
                </Link>
                <div className="result-actions">
                  <CollectionButton
                    action="收藏检索结果"
                    compact
                    itemType="knowledge_search"
                    label="收藏结果"
                    module="knowledge"
                    snapshot={{
                      catalog: x.catalog,
                      category: x.category,
                      excerpt: x.excerpt,
                      id: x.id,
                      source: x.source,
                      title: x.title,
                      url: x.url,
                    }}
                    sourceId={`knowledge:${x.id}`}
                    step={`search:${x.id}`}
                    summary={x.excerpt}
                    tags={x.category}
                    title={x.title}
                    url={`/knowledge/${x.id}`}
                  />
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">输入关键词开始检索。知识库已连接 764 条结构化页面。</div>
          )}
        </div>
      </div>
      <aside className="graph-card">
        <p className="kicker light">概念关系示意</p>
        <span className="graph-node">五行</span>
        <span className="graph-node">天干</span>
        <span className="graph-node">地支</span>
        <span className="graph-node">十神</span>
        <span className="graph-node">四柱</span>
      </aside>
    </div>
  );
}
