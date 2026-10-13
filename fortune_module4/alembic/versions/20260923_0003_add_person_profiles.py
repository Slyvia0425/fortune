"""Add per-user person profiles.

Revision ID: 20260923_0003
Revises: 20260922_0002
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260923_0003"
down_revision: str | None = "20260922_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "person_profiles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("relation", sa.String(length=64), nullable=True),
        sa.Column("gender", sa.String(length=32), nullable=True),
        sa.Column("calendar", sa.String(length=16), nullable=True),
        sa.Column("birth_date", sa.String(length=32), nullable=True),
        sa.Column("birth_time", sa.String(length=16), nullable=True),
        sa.Column("birth_place", sa.JSON(), nullable=False),
        sa.Column("chart_snapshot", sa.JSON(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_person_profile_user_name"),
    )
    op.create_index("ix_person_profiles_user_id", "person_profiles", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_person_profiles_user_id", table_name="person_profiles")
    op.drop_table("person_profiles")
