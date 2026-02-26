"""add tabela anexos

Revision ID: add_anexos_table
Revises: add_empresa_setor
Create Date: 2026-02-26
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_anexos_table'
down_revision = 'add_empresa_setor'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'anexos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('id_tarefa', sa.Integer(), sa.ForeignKey('tarefas.codigo'), nullable=False),
        sa.Column('id_usuario', sa.Integer(), sa.ForeignKey('usuarios.id'), nullable=False),
        sa.Column('nome_original', sa.String(255), nullable=False),
        sa.Column('nome_arquivo', sa.String(255), nullable=False),
        sa.Column('tamanho', sa.Integer(), nullable=False),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('data_upload', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade():
    op.drop_table('anexos')
