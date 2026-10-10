"""Separate public-knowledge tables; never touch private user case/profile tables.

PostgreSQL uses variable-dimension pgvector; profile isolation is enforced by the
service. SQLite JSON is a functional local path, not a performance substitute.
"""

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.types import TypeDecorator


class KnowledgeVector(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(Vector() if dialect.name == "postgresql" else JSON())


metadata = MetaData()


def table(name, *cols, **kw):
    return Table("knowledge_" + name, metadata, *cols, **kw)


source = table(
    "source_revision",
    Column("source_revision_id", String, primary_key=True),
    Column("source_id", String, nullable=False, index=True),
    Column("book", String, nullable=False),
    Column("edition", String),
    Column("url", Text),
    Column("raw_text", Text, nullable=False),
    Column("raw_sha256", String, nullable=False),
    Column("offset_unit", String, nullable=False),
    Column("review_status", String, nullable=False),
)
entity = table(
    "entity_revision",
    Column("revision_id", String, primary_key=True),
    Column("entity_id", String, nullable=False, index=True),
    Column("kind", String, nullable=False, index=True),
    Column("parent_id", String),
    Column("case_group_id", String),
    Column("reading_id", String),
    Column("text", Text, nullable=False),
    Column("content_hash", String, nullable=False),
    Column("review_status", String, nullable=False, index=True),
    Column("production_eligible", Boolean, nullable=False, default=False),
    Column("metadata_json", JSON, nullable=False),
)
lineage = table(
    "lineage",
    Column("lineage_id", String, primary_key=True),
    Column(
        "entity_revision_id", String, ForeignKey(entity.c.revision_id), nullable=False, index=True
    ),
    Column(
        "source_revision_id",
        String,
        ForeignKey(source.c.source_revision_id),
        nullable=False,
        index=True,
    ),
    Column("passage_id", String),
    Column("start", Integer, nullable=False),
    Column("end", Integer, nullable=False),
    Column("quote_hash", String, nullable=False),
    Column("relation", String, nullable=False),
    CheckConstraint("start >= 0 AND end > start"),
)
rule = table(
    "rule",
    Column("entity_revision_id", String, ForeignKey(entity.c.revision_id), primary_key=True),
    Column("rule_type", String, nullable=False, index=True),
    Column("method_profile_id", String, nullable=False, index=True),
    Column("conditions_ast", JSON),
    Column("action_ast", JSON),
    Column("exceptions_ast", JSON),
    Column("conflict_group_ids", JSON, nullable=False),
    Column("executable", Boolean, nullable=False, default=False),
)
view = table(
    "search_view",
    Column("view_id", String, primary_key=True),
    Column(
        "entity_revision_id", String, ForeignKey(entity.c.revision_id), nullable=False, index=True
    ),
    Column("view_type", String, nullable=False),
    Column("text", Text, nullable=False),
    Column("text_hash", String, nullable=False),
    Column("normalizer_version", String, nullable=False),
    Column("summary_review_status", String, nullable=False),
    Column("embedding_allowed", Boolean, nullable=False),
    Column("transforms", JSON, nullable=False),
)
profile = table(
    "embedding_profile",
    Column("profile_id", String, primary_key=True),
    Column("config", JSON, nullable=False),
    Column("verified", Boolean, nullable=False),
    Column("dimension", Integer, nullable=False),
    CheckConstraint("dimension > 0"),
)
job = table(
    "embedding_job",
    Column("job_id", String, primary_key=True),
    Column("view_id", String, ForeignKey(view.c.view_id), nullable=False),
    Column("profile_id", String, ForeignKey(profile.c.profile_id), nullable=False),
    Column("input_hash", String, nullable=False),
    Column("status", String, nullable=False),
    Column("attempts", Integer, nullable=False, default=0),
    Column("error", String),
    Column("elapsed_ms", Integer),
    UniqueConstraint("view_id", "profile_id"),
)
embedding = table(
    "embedding",
    Column("view_id", String, ForeignKey(view.c.view_id), primary_key=True),
    Column("profile_id", String, ForeignKey(profile.c.profile_id), primary_key=True),
    Column("dimension", Integer, nullable=False),
    Column("vector", KnowledgeVector(), nullable=False),
    Column("vector_hash", String, nullable=False),
    Column("job_id", String, ForeignKey(job.c.job_id), nullable=False),
)
release = table(
    "release",
    Column("release_id", String, primary_key=True),
    Column("status", String, nullable=False),
    Column("parent_release_id", String),
    Column("manifest_hash", String, nullable=False),
    Column("profile_id", String, ForeignKey(profile.c.profile_id)),
    Column("created_at", String, nullable=False),
    Column("validation", JSON, nullable=False),
)
release_item = table(
    "release_item",
    Column("release_id", String, ForeignKey(release.c.release_id), primary_key=True),
    Column("entity_revision_id", String, ForeignKey(entity.c.revision_id), primary_key=True),
    Column("view_id", String, ForeignKey(view.c.view_id), primary_key=True),
)
revocation = table(
    "revocation",
    Column("revocation_id", String, primary_key=True),
    Column("entity_revision_id", String, ForeignKey(entity.c.revision_id)),
    Column("source_revision_id", String, ForeignKey(source.c.source_revision_id)),
    Column("reason", Text, nullable=False),
    Column("revoked_at", String, nullable=False),
    CheckConstraint("entity_revision_id IS NOT NULL OR source_revision_id IS NOT NULL"),
)
active = table(
    "active_release",
    Column("name", String, primary_key=True),
    Column("release_id", String, ForeignKey(release.c.release_id), nullable=False),
)
