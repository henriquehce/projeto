"""add Admin Master e tabela tarefa_admins

Revision ID: add_admin_master
Revises: add_empresa_setor
Create Date: 2025-01-01 00:00:01
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_admin_master'
down_revision = 'add_empresa_setor'
branch_labels = None
depends_on = None


def upgrade():
    # Cria tabela de admins colaboradores por tarefa
    op.create_table(
        'tarefa_admins',
        sa.Column('tarefa_codigo', sa.Integer, sa.ForeignKey('tarefas.codigo'), primary_key=True),
        sa.Column('usuario_id',    sa.Integer, sa.ForeignKey('usuarios.id'),    primary_key=True)
    )
    # Nota: o valor 'Admin Master' no campo tipo_perfil nao precisa de migration
    # no banco pois e apenas uma string — basta atualizar o usuario desejado via SQL:
    # UPDATE usuarios SET tipo_perfil = 'Admin Master' WHERE email = 'henriquecipriani@gmail.com';


def downgrade():
    op.drop_table('tarefa_admins')
