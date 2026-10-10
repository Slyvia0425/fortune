"""Add the inference-eligibility flag to archived session events.

Revision ID: 20261008_0004
Revises: 20260923_0003
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261008_0004"
down_revision: str | None = "20260923_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INFERENCE_EVENT_TYPES = (
    "module1.chart.completed",
    "module2a.divination.completed",
    "knowledge.item.opened",
    "recommendation.impression",
    "recommendation.click",
    "collection.created",
    "note.created",
    "tag.assigned",
    "feedback.submitted",
)


def upgrade() -> None:
    op.add_column(
        "session_events",
        sa.Column(
            "inference_eligible",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    quoted_types = ", ".join(f"'{event_type}'" for event_type in INFERENCE_EVENT_TYPES)
    op.execute(
        sa.text(
            "UPDATE session_events "
            f"SET inference_eligible = TRUE WHERE event_type IN ({quoted_types})"
        )
    )
    op.create_index(
        "ix_session_events_inference_eligible",
        "session_events",
        ["inference_eligible"],
    )


def downgrade() -> None:
    op.drop_index("ix_session_events_inference_eligible", table_name="session_events")
    op.drop_column("session_events", "inference_eligible")
