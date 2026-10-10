"""Add isolated knowledge v2 tables (no private data migration)."""

from alembic import op
from app.services.knowledge_v2.schema import metadata

revision = "20261010_0002"
down_revision = "20260922_0002"
branch_labels = None
depends_on = None


def upgrade():
    metadata.create_all(op.get_bind(), checkfirst=True)


def downgrade():
    metadata.drop_all(op.get_bind(), checkfirst=True)
