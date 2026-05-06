"""initial migration

Revision ID: 0001_initial
Revises: 
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'users',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('username', sa.String, unique=True, nullable=False),
        sa.Column('password_hash', sa.String, nullable=False),
        sa.Column('is_admin', sa.Boolean, nullable=True),
    )
    op.create_table(
        'keystore',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('enc_private_key', sa.Text, nullable=False),
        sa.Column('pubkey', sa.String, nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=True),
    )
    op.create_table(
        'wallets',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('address', sa.String, nullable=False),
        sa.Column('balance', sa.Float, nullable=True),
    )
    op.create_table(
        'transactions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('sender_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('receiver', sa.String, nullable=False),
        sa.Column('amount', sa.Float, nullable=False),
        sa.Column('status', sa.String, nullable=True),
        sa.Column('signature', sa.String, nullable=True),
        sa.Column('slot', sa.Integer, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=True),
    )
    op.create_table(
        'security_logs',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('event_type', sa.String, nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=True),
    )


def downgrade():
    op.drop_table('security_logs')
    op.drop_table('transactions')
    op.drop_table('wallets')
    op.drop_table('keystore')
    op.drop_table('users')
