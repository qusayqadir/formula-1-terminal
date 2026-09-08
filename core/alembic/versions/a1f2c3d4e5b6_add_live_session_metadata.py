"""add live session metadata columns

Adds the rich metadata carried on the OpenF1 `sessions` topic (circuit,
country, session name/type, dates) to bronze.live_session, which previously
only held session_key/meeting_key.

Revision ID: a1f2c3d4e5b6
Revises: 12abb55b11db
Create Date: 2026-09-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1f2c3d4e5b6'
down_revision: Union[str, Sequence[str], None] = '12abb55b11db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        ALTER TABLE bronze.live_session
            ADD COLUMN IF NOT EXISTS circuit_key        INTEGER,
            ADD COLUMN IF NOT EXISTS circuit_short_name TEXT,
            ADD COLUMN IF NOT EXISTS country_code       TEXT,
            ADD COLUMN IF NOT EXISTS country_key        INTEGER,
            ADD COLUMN IF NOT EXISTS country_name       TEXT,
            ADD COLUMN IF NOT EXISTS location           TEXT,
            ADD COLUMN IF NOT EXISTS session_name       TEXT,
            ADD COLUMN IF NOT EXISTS session_type       TEXT,
            ADD COLUMN IF NOT EXISTS year               INTEGER,
            ADD COLUMN IF NOT EXISTS date_start         TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS date_end           TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS gmt_offset         TEXT,
            ADD COLUMN IF NOT EXISTS is_cancelled       BOOLEAN
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("""
        ALTER TABLE bronze.live_session
            DROP COLUMN IF EXISTS circuit_key,
            DROP COLUMN IF EXISTS circuit_short_name,
            DROP COLUMN IF EXISTS country_code,
            DROP COLUMN IF EXISTS country_key,
            DROP COLUMN IF EXISTS country_name,
            DROP COLUMN IF EXISTS location,
            DROP COLUMN IF EXISTS session_name,
            DROP COLUMN IF EXISTS session_type,
            DROP COLUMN IF EXISTS year,
            DROP COLUMN IF EXISTS date_start,
            DROP COLUMN IF EXISTS date_end,
            DROP COLUMN IF EXISTS gmt_offset,
            DROP COLUMN IF EXISTS is_cancelled
    """)
