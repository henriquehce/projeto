"""add tabela checklist_items

Revision ID: add_checklist_items
Revises: add_anexos_table
Create Date: 2026-02-26
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_checklist_items'
down_revision = 'add_anexos_table'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'checklist_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('id_tarefa', sa.Integer(), sa.ForeignKey('tarefas.codigo'), nullable=False),
        sa.Column('texto', sa.String(500), nullable=False),
        sa.Column('ordem', sa.Integer(), default=0),
        sa.Column('concluido', sa.Boolean(), default=False),
        sa.Column('observacao', sa.Text(), nullable=True),
        sa.Column('concluido_por', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True),
        sa.Column('concluido_em', sa.DateTime(), nullable=True),
        sa.Column('criado_por', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=True),
        sa.Column('criado_em', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade():
    op.drop_table('checklist_items')
