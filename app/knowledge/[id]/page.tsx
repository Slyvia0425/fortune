import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import CollectionButton from "@/app/components/collection-button";
import { getKnowledgePageById } from "@/lib/knowledge/library";

import "../detail.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const page = getKnowledgePageById(id);
  return { title: page ? `${page.title} · 典籍原文` : "典籍原文" };
}

export default async function KnowledgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const page = getKnowledgePageById(id);
  if (!page) notFound();

  return (
    <main className="subpage">
      <section className="page-hero">
        <div className="page-shell">
          <p className="crumb">
            <Link href="/">首页</Link> ／ <Link href="/knowledge">典籍求索</Link> ／ 原文
          </p>
          <p className="kicker">{page.source.toUpperCase()} · ORIGINAL SOURCE</p>
          <h1 className="page-title">{page.title}</h1>
          <p>
            {page.catalog}
            {page.category.length ? ` · ${page.category.join(" / ")}` : ""}
          </p>
        </div>
      </section>

      <section className="page-shell section-block">
        <div className="source-detail">
          <div className="source-actions">
            <CollectionButton
              action="收藏典籍原文"
              itemType="knowledge_reading"
              label="收藏原文"
              module="knowledge"
              snapshot={{
                catalog: page.catalog,
                category: page.category,
                content: page.content.slice(0, 4000),
                source: page.source,
                title: page.title,
                url: page.url,
              }}
              sourceId={`knowledge:${id}`}
              step={`reading:${id}`}
              summary={page.content.replace(/\s+/g, " ").trim().slice(0, 180)}
              tags={page.category}
              title={page.title}
              url={`/knowledge/${id}`}
            />
            <a
              className="button button-primary"
              href={page.url}
              rel="noreferrer"
              target="_blank"
            >
              查看原始来源
            </a>
          </div>
          <article className="source-content">
            {page.content.split(/\n+/).map((paragraph, index) => (
              <p key={`${id}-${index}`}>{paragraph}</p>
            ))}
          </article>
        </div>
      </section>
    </main>
  );
}
