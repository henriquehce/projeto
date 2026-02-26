"""add empresa e setor to usuarios e empresa to tarefas

Revision ID: add_empresa_setor
Revises: 
Create Date: 2025-01-01 00:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_empresa_setor'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Adiciona empresa e setor nos usuarios
    with op.batch_alter_table('usuarios', schema=None) as batch_op:
        batch_op.add_column(sa.Column('empresa', sa.String(150), nullable=True))
        batch_op.add_column(sa.Column('setor', sa.String(150), nullable=True))

    # Adiciona empresa nas tarefas
    with op.batch_alter_table('tarefas', schema=None) as batch_op:
        batch_op.add_column(sa.Column('empresa', sa.String(150), nullable=True))


def downgrade():
    with op.batch_alter_table('tarefas', schema=None) as batch_op:
        batch_op.drop_column('empresa')

    with op.batch_alter_table('usuarios', schema=None) as batch_op:
        batch_op.drop_column('setor')
        batch_op.drop_column('empresa')
