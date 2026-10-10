"""Transactional release pointer and global revocation; never auto-approve entities."""

from datetime import UTC, datetime

from sqlalchemy import select

from . import schema as s
from .ingest import identity
from .retrieval import allowed_rows, quotes


def validate_for_publication(conn, release_id):
    release = (
        conn.execute(select(s.release).where(s.release.c.release_id == release_id)).mappings().one()
    )
    items = (
        conn.execute(select(s.release_item).where(s.release_item.c.release_id == release_id))
        .mappings()
        .all()
    )
    if not items:
        raise ValueError("EMPTY_RELEASE")
    profile = (
        conn.execute(select(s.profile).where(s.profile.c.profile_id == release["profile_id"]))
        .mappings()
        .one()
    )
    if not profile["verified"]:
        raise ValueError("EMBEDDING_PROFILE_UNVERIFIED")
    if not release["validation"].get("independent_retrieval_evaluation_passed"):
        raise ValueError("INDEPENDENT_RETRIEVAL_EVALUATION_MISSING")
    _, rows = allowed_rows(conn, release_id, review=True)
    by_id = {r["revision_id"]: r for r in rows}
    for item in items:
        r = by_id.get(item["entity_revision_id"])
        if (
            r is None
            or not r["production_eligible"]
            or r["review_status"] not in ("approved", "published")
        ):
            raise ValueError("UNAPPROVED_OR_REVOKED_ENTITY")
        if r["rule"] and (not r["rule"]["executable"] or not r["rule"]["conditions_ast"]):
            raise ValueError("RULE_AST_NOT_REVIEWED")
        quotes(conn, r["revision_id"])
        linked = (
            conn.execute(
                select(s.source.c.review_status)
                .join(s.lineage)
                .where(s.lineage.c.entity_revision_id == r["revision_id"])
            )
            .scalars()
            .all()
        )
        if any(status not in ("approved", "published") for status in linked):
            raise ValueError("SOURCE_REVIEW_INCOMPLETE")
        vector = (
            conn.execute(
                select(s.embedding).where(
                    s.embedding.c.view_id == item["view_id"],
                    s.embedding.c.profile_id == release["profile_id"],
                )
            )
            .mappings()
            .first()
        )
        if not vector:
            raise ValueError("EMBEDDING_INCOMPLETE")
    return release


def activate(engine, release_id):
    with engine.begin() as conn:
        rel = validate_for_publication(conn, release_id)
        if rel["status"] not in ("validated", "published"):
            raise ValueError("RELEASE_NOT_VALIDATED")
        row = conn.execute(
            select(s.active).where(s.active.c.name == "production").with_for_update()
        ).first()
        if row:
            conn.execute(
                s.active.update()
                .where(s.active.c.name == "production")
                .values(release_id=release_id)
            )
        else:
            conn.execute(s.active.insert().values(name="production", release_id=release_id))
        conn.execute(
            s.release.update()
            .where(s.release.c.release_id == release_id)
            .values(status="published")
        )


def revoke(engine, *, entity_revision_id=None, source_revision_id=None, reason):
    if not reason.strip() or not (entity_revision_id or source_revision_id):
        raise ValueError("Revocation target and reason required")
    row = {
        "entity_revision_id": entity_revision_id,
        "source_revision_id": source_revision_id,
        "reason": reason,
        "revoked_at": datetime.now(UTC).isoformat(),
    }
    with engine.begin() as conn:
        conn.execute(s.revocation.insert().values(revocation_id=identity("revocation", row), **row))
