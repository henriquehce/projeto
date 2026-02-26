from flask import Flask, jsonify, request, render_template, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import urllib.request
import json as _json
from datetime import datetime
from functools import wraps
import bcrypt
import re
import os
import threading
import uuid
import mimetypes
from werkzeug.utils import secure_filename

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─────────────────────────────────────────
# CONFIGURACAO
# ─────────────────────────────────────────
ADMIN_MASTER_EMAIL = 'henriquecipriani@gmail.com'

def get_database_url():
    url = os.environ.get('DATABASE_URL', 'sqlite:///taskflow.db')
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url

app = Flask(__name__)
app.config['SECRET_KEY']                     = os.environ.get('SECRET_KEY', 'taskflow-dev-secret-troque-em-producao')
app.config['SQLALCHEMY_DATABASE_URI']        = get_database_url()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

if os.environ.get('FLASK_ENV') == 'production':
    app.config['SESSION_COOKIE_SECURE']   = True
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Upload config
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024  # 25MB max

EXTENSOES_PERMITIDAS = {
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'txt', 'csv', 'zip', 'rar', '7z',
    'png', 'jpg', 'jpeg', 'gif', 'webp',
    'mp4', 'mov', 'avi'
}

db   = SQLAlchemy(app)
CORS(app)

# ─────────────────────────────────────────
# TABELA ASSOCIATIVA — responsaveis (colaborativos)
# ─────────────────────────────────────────
tarefa_responsaveis = db.Table('tarefa_responsaveis',
    db.Column('tarefa_codigo', db.Integer, db.ForeignKey('tarefas.codigo'), primary_key=True),
    db.Column('usuario_id',    db.Integer, db.ForeignKey('usuarios.id'),    primary_key=True)
)

# ─────────────────────────────────────────
# TABELA ASSOCIATIVA — admins colaboradores na tarefa
# ─────────────────────────────────────────
tarefa_admins = db.Table('tarefa_admins',
    db.Column('tarefa_codigo', db.Integer, db.ForeignKey('tarefas.codigo'), primary_key=True),
    db.Column('usuario_id',    db.Integer, db.ForeignKey('usuarios.id'),    primary_key=True)
)

from flask_migrate import Migrate
migrate = Migrate(app, db)

# ─────────────────────────────────────────
# PERFIS
# Tipos: 'Admin Master', 'Administrador', 'Colaborativo'
# Admin Master  → vê TODAS as tarefas da empresa, cria outros Admin Masters
# Administrador → vê APENAS suas proprias tarefas
# Colaborativo  → vê apenas tarefas atribuidas a ele
# ─────────────────────────────────────────

def validar_senha_forte(senha):
    if len(senha) < 8:
        return False, 'A senha deve ter pelo menos 8 caracteres'
    if not re.search(r'[A-Z]', senha):
        return False, 'A senha deve conter pelo menos 1 letra maiuscula'
    if not re.search(r'[a-z]', senha):
        return False, 'A senha deve conter pelo menos 1 letra minuscula'
    if not re.search(r'\d', senha):
        return False, 'A senha deve conter pelo menos 1 numero'
    if not re.search(r'[!@#$%^&*(),.?\":{}|<>\-_=+\[\]\\;\'`~/]', senha):
        return False, 'A senha deve conter pelo menos 1 caractere especial (!@#$%^&* etc.)'
    return True, None


# ─────────────────────────────────────────
# MODELOS
# ─────────────────────────────────────────
class Usuario(db.Model):
    __tablename__ = 'usuarios'
    id            = db.Column(db.Integer, primary_key=True)
    nome          = db.Column(db.String(100), nullable=False)
    funcao        = db.Column(db.String(100), nullable=False)
    email         = db.Column(db.String(150), unique=True, nullable=False)
    senha_hash    = db.Column(db.String(255), nullable=False)
    tipo_perfil   = db.Column(db.String(20), nullable=False)
    trocar_senha  = db.Column(db.Boolean, default=False)
    empresa       = db.Column(db.String(150), nullable=True)
    setor         = db.Column(db.String(150), nullable=True)
    comentarios   = db.relationship('Comentario', backref='autor', lazy=True)

    def definir_senha(self, senha_plain):
        self.senha_hash = bcrypt.hashpw(
            senha_plain.encode('utf-8'), bcrypt.gensalt()
        ).decode('utf-8')

    def verificar_senha(self, senha_plain):
        return bcrypt.checkpw(
            senha_plain.encode('utf-8'), self.senha_hash.encode('utf-8')
        )

    def is_admin(self):
        return self.tipo_perfil in ('Administrador', 'Admin Master')

    def is_master(self):
        return self.tipo_perfil == 'Admin Master'

    def to_dict(self):
        return {
            'id':           self.id,
            'nome':         self.nome,
            'funcao':       self.funcao,
            'email':        self.email,
            'tipo_perfil':  self.tipo_perfil,
            'trocar_senha': self.trocar_senha,
            'empresa':      self.empresa or '',
            'setor':        self.setor or ''
        }


class Tarefa(db.Model):
    __tablename__ = 'tarefas'
    codigo         = db.Column(db.Integer, primary_key=True, autoincrement=True)
    descricao      = db.Column(db.Text, nullable=False)
    data_criacao   = db.Column(db.DateTime, default=datetime.utcnow)
    status         = db.Column(db.String(30), default='Nao iniciado')
    prioridade     = db.Column(db.String(10), default='Nenhuma')
    compartilhada  = db.Column(db.Boolean, default=True)
    criado_por     = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=True)
    empresa        = db.Column(db.String(150), nullable=True)
    responsaveis   = db.relationship('Usuario', secondary=tarefa_responsaveis, lazy='subquery',
                                     backref=db.backref('tarefas_responsavel', lazy=True),
                                     foreign_keys=[tarefa_responsaveis.c.tarefa_codigo,
                                                   tarefa_responsaveis.c.usuario_id])
    admins_colabs  = db.relationship('Usuario', secondary=tarefa_admins, lazy='subquery',
                                     backref=db.backref('tarefas_admin_colab', lazy=True),
                                     foreign_keys=[tarefa_admins.c.tarefa_codigo,
                                                   tarefa_admins.c.usuario_id])
    comentarios    = db.relationship('Comentario', backref='tarefa', lazy=True, cascade='all, delete-orphan')
    anexos         = db.relationship('Anexo', backref='tarefa', lazy=True, cascade='all, delete-orphan',
                                     foreign_keys='Anexo.id_tarefa')

    def to_dict(self, viewer_id=None):
        # Calcula badges de perspectiva do viewer
        delegada = False
        comigo   = False
        if viewer_id is not None:
            resp_ids       = [u.id for u in self.responsaveis]
            admin_colab_ids = [u.id for u in self.admins_colabs]
            if self.criado_por == viewer_id:
                delegada = True
            if viewer_id in resp_ids or viewer_id in admin_colab_ids:
                comigo = True

        return {
            'codigo':        self.codigo,
            'descricao':     self.descricao,
            'data_criacao':  self.data_criacao.strftime('%d/%m/%Y %H:%M'),
            'status':        self.status,
            'prioridade':    self.prioridade,
            'compartilhada': self.compartilhada,
            'criado_por':    self.criado_por,
            'empresa':       self.empresa or '',
            'delegada':      delegada,
            'comigo':        comigo,
            'responsaveis':  [
                {'id': u.id, 'nome': u.nome, 'funcao': u.funcao, 'setor': u.setor or ''}
                for u in self.responsaveis
            ],
            'admins_colabs': [
                {'id': u.id, 'nome': u.nome, 'funcao': u.funcao}
                for u in self.admins_colabs
            ],
            'anexos_count': len(self.anexos)
        }


class Comentario(db.Model):
    __tablename__ = 'comentarios'
    id         = db.Column(db.Integer, primary_key=True)
    id_tarefa  = db.Column(db.Integer, db.ForeignKey('tarefas.codigo'), nullable=False)
    id_usuario = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    texto      = db.Column(db.Text, nullable=False)
    tipo       = db.Column(db.String(20), default='comentario')
    data_hora  = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id':           self.id,
            'texto':        self.texto,
            'tipo':         self.tipo,
            'data_hora':    self.data_hora.strftime('%d/%m/%Y %H:%M:%S'),
            'autor_nome':   self.autor.nome if self.autor else 'Sistema',
            'autor_perfil': self.autor.tipo_perfil if self.autor else 'sistema'
        }


class Anexo(db.Model):
    __tablename__ = 'anexos'
    id           = db.Column(db.Integer, primary_key=True)
    id_tarefa    = db.Column(db.Integer, db.ForeignKey('tarefas.codigo'), nullable=False)
    id_usuario   = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    nome_original = db.Column(db.String(255), nullable=False)
    nome_arquivo = db.Column(db.String(255), nullable=False)  # UUID filename on disk
    tamanho      = db.Column(db.Integer, nullable=False)      # bytes
    mime_type    = db.Column(db.String(100), nullable=True)
    data_upload  = db.Column(db.DateTime, default=datetime.utcnow)
    uploader     = db.relationship('Usuario', foreign_keys=[id_usuario])

    def to_dict(self):
        return {
            'id':            self.id,
            'nome_original': self.nome_original,
            'tamanho':       self.tamanho,
            'mime_type':     self.mime_type or '',
            'data_upload':   self.data_upload.strftime('%d/%m/%Y %H:%M'),
            'uploader_nome': self.uploader.nome if self.uploader else 'Desconhecido',
            'url_download':  f'/api/anexos/{self.id}/download'
        }


# ─────────────────────────────────────────
# EMAIL HELPERS
# ─────────────────────────────────────────
def _enviar_async(destinatarios, assunto, corpo_html):
    api_key = os.environ.get('BREVO_API_KEY')
    if not api_key:
        return
    payload = _json.dumps({
        'sender':      {'name': 'TaskFlow', 'email': os.environ.get('EMAIL_REMETENTE', 'noreply@taskflow.app')},
        'to':          [{'email': e} for e in destinatarios],
        'subject':     assunto,
        'htmlContent': corpo_html
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.brevo.com/v3/smtp/email',
        data=payload,
        headers={'api-key': api_key, 'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f'[EMAIL] Enviado: {resp.status}')
    except Exception as e:
        print(f'[EMAIL] Erro ao enviar: {e}')


def enviar_email(destinatarios, assunto, corpo_html):
    if not os.environ.get('BREVO_API_KEY'):
        return
    if not destinatarios:
        return
    t = threading.Thread(target=_enviar_async, args=(destinatarios, assunto, corpo_html))
    t.daemon = True
    t.start()


def _template_base(titulo, conteudo):
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f4f4f4; padding: 20px;">
        <div style="background: #0f172a; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px;">TaskFlow</h1>
        </div>
        <div style="background: #ffffff; padding: 32px; border-radius: 0 0 8px 8px;">
            <h2 style="color: #0f172a; margin-top: 0;">{titulo}</h2>
            {conteudo}
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">Email automatico do TaskFlow. Nao responda.</p>
        </div>
    </div>"""


def _emails_envolvidos_tarefa(tarefa, excluir_id=None):
    """Retorna set de emails de todos os envolvidos: responsaveis + admins colabs + admin criador."""
    emails = set()
    for u in tarefa.responsaveis:
        if u.id != excluir_id:
            emails.add(u.email)
    for u in tarefa.admins_colabs:
        if u.id != excluir_id:
            emails.add(u.email)
    if tarefa.criado_por and tarefa.criado_por != excluir_id:
        criador = db.session.get(Usuario, tarefa.criado_por)
        if criador:
            emails.add(criador.email)
    return emails


def email_tarefa_criada(tarefa, responsaveis, admin_nome, admin_email):
    emails = set(u.email for u in responsaveis)
    if tarefa.empresa:
        masters = Usuario.query.filter_by(tipo_perfil='Admin Master', empresa=tarefa.empresa).all()
        for a in masters:
            if a.email != admin_email:
                emails.add(a.email)
    if not emails:
        return
    prioridade_cor = {'Alta': '#ef4444'}.get(tarefa.prioridade, '#64748b')
    resp_nomes = ', '.join(u.nome for u in responsaveis) if responsaveis else 'Nenhum'
    conteudo = f"""
        <p>Uma nova tarefa foi criada:</p>
        <div style="background:#f8fafc;border-left:4px solid #3b82f6;padding:16px;border-radius:4px;margin:16px 0">
            <p style="margin:0 0 8px"><strong>Tarefa:</strong> {tarefa.descricao}</p>
            <p style="margin:0 0 8px"><strong>Prioridade:</strong> <span style="color:{prioridade_cor};font-weight:bold">{tarefa.prioridade}</span></p>
            <p style="margin:0 0 8px"><strong>Responsaveis:</strong> {resp_nomes}</p>
            <p style="margin:0"><strong>Criada por:</strong> {admin_nome}</p>
        </div>"""
    enviar_email(list(emails), '[TaskFlow] Nova tarefa criada', _template_base('Nova tarefa criada', conteudo))


def email_tarefa_atribuida(tarefa, responsaveis_novos, admin_nome):
    if not responsaveis_novos:
        return
    prioridade_cor = {'Alta': '#ef4444'}.get(tarefa.prioridade, '#64748b')
    conteudo = f"""
        <p>Voce foi atribuido(a) a seguinte tarefa:</p>
        <div style="background:#f8fafc;border-left:4px solid #3b82f6;padding:16px;border-radius:4px;margin:16px 0">
            <p style="margin:0 0 8px"><strong>Tarefa:</strong> {tarefa.descricao}</p>
            <p style="margin:0 0 8px"><strong>Prioridade:</strong> <span style="color:{prioridade_cor};font-weight:bold">{tarefa.prioridade}</span></p>
            <p style="margin:0"><strong>Atribuida por:</strong> {admin_nome}</p>
        </div>"""
    enviar_email([u.email for u in responsaveis_novos], '[TaskFlow] Tarefa atribuida a voce', _template_base('Nova tarefa atribuida', conteudo))


def email_comentario_adicionado(tarefa, comentario_texto, autor_nome, autor_id):
    """Notifica todos os envolvidos (responsaveis + admins colabs + admin criador), exceto quem comentou."""
    envolvidos = _emails_envolvidos_tarefa(tarefa, excluir_id=autor_id)
    if not envolvidos:
        return
    conteudo = f"""
        <p>Novo comentario na tarefa que voce acompanha:</p>
        <div style="background:#f8fafc;border-left:4px solid #3b82f6;padding:16px;border-radius:4px;margin:16px 0">
            <p style="margin:0"><strong>Tarefa:</strong> {tarefa.descricao}</p>
        </div>
        <div style="background:#f1f5f9;border-radius:4px;padding:16px;margin:16px 0">
            <p style="margin:0 0 4px;color:#64748b;font-size:12px"><strong>{autor_nome}</strong> comentou:</p>
            <p style="margin:0;color:#0f172a">{comentario_texto}</p>
        </div>"""
    enviar_email(list(envolvidos), '[TaskFlow] Novo comentario na tarefa', _template_base('Novo comentario', conteudo))


def email_status_alterado(tarefa, status_anterior, status_novo, alterado_por_nome, alterado_por_id):
    """Notifica todos os envolvidos sobre mudanca de status, exceto quem alterou."""
    emails = list(_emails_envolvidos_tarefa(tarefa, excluir_id=alterado_por_id))
    if not emails:
        return
    STATUS_COR = {
        'Nao iniciado': '#94a3b8', 'Iniciado': '#3b82f6', 'Em andamento': '#8b5cf6',
        'Pausado': '#f59e0b', 'Aguardo retorno': '#f97316', 'Finalizado': '#22c55e',
    }
    cor = STATUS_COR.get(status_novo, '#64748b')
    conteudo = f"""
        <p>O status de uma tarefa foi atualizado:</p>
        <div style="background:#f8fafc;border-left:4px solid {cor};padding:16px;border-radius:4px;margin:16px 0">
            <p style="margin:0 0 8px"><strong>Tarefa:</strong> {tarefa.descricao}</p>
            <p style="margin:0 0 8px"><strong>Antes:</strong> <span style="color:#64748b">{status_anterior}</span></p>
            <p style="margin:0 0 8px"><strong>Agora:</strong> <span style="color:{cor};font-weight:bold">{status_novo}</span></p>
            <p style="margin:0"><strong>Alterado por:</strong> {alterado_por_nome}</p>
        </div>"""
    enviar_email(emails, f'[TaskFlow] Status atualizado: "{status_novo}"', _template_base('Status da tarefa atualizado', conteudo))


# ─────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────
def registrar_historico(id_tarefa, id_usuario, texto):
    db.session.add(Comentario(id_tarefa=id_tarefa, id_usuario=id_usuario, texto=texto, tipo='historico'))


# ─────────────────────────────────────────
# DECORADORES
# ─────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({'erro': 'Nao autenticado'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """Permite Administrador e Admin Master."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({'erro': 'Nao autenticado'}), 401
        u = db.session.get(Usuario, session['usuario_id'])
        if not u or not u.is_admin():
            return jsonify({'erro': 'Acesso negado. Apenas administradores.'}), 403
        return f(*args, **kwargs)
    return decorated


def master_required(f):
    """Permite apenas Admin Master."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({'erro': 'Nao autenticado'}), 401
        u = db.session.get(Usuario, session['usuario_id'])
        if not u or not u.is_master():
            return jsonify({'erro': 'Acesso negado. Apenas Admin Master.'}), 403
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────
# ROTA PRINCIPAL
# ─────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')


# ─────────────────────────────────────────
# AUTENTICACAO
# ─────────────────────────────────────────
@app.route('/api/login', methods=['POST'])
def login():
    dados = request.json
    email = dados.get('email', '').strip().lower()
    senha = dados.get('senha', '')
    if not email or not senha:
        return jsonify({'erro': 'E-mail e senha sao obrigatorios'}), 400
    usuario = Usuario.query.filter_by(email=email).first()
    if not usuario or not usuario.verificar_senha(senha):
        return jsonify({'erro': 'E-mail ou senha incorretos'}), 401
    session['usuario_id'] = usuario.id
    return jsonify(usuario.to_dict()), 200


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'mensagem': 'Logout realizado'}), 200


@app.route('/api/me', methods=['GET'])
@login_required
def me():
    u = db.session.get(Usuario, session['usuario_id'])
    return jsonify(u.to_dict()), 200


# ─────────────────────────────────────────
# TROCAR / REDEFINIR SENHA
# ─────────────────────────────────────────
@app.route('/api/trocar-senha', methods=['POST'])
@login_required
def trocar_senha():
    dados = request.json
    senha_atual = dados.get('senha_atual', '')
    senha_nova  = dados.get('senha_nova', '')
    senha_conf  = dados.get('senha_confirmacao', '')
    if not senha_atual or not senha_nova or not senha_conf:
        return jsonify({'erro': 'Preencha todos os campos'}), 400
    valida, erro = validar_senha_forte(senha_nova)
    if not valida:
        return jsonify({'erro': erro}), 400
    if senha_nova != senha_conf:
        return jsonify({'erro': 'A confirmacao de senha nao confere'}), 400
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not usuario.verificar_senha(senha_atual):
        return jsonify({'erro': 'Senha atual incorreta'}), 401
    usuario.definir_senha(senha_nova)
    usuario.trocar_senha = False
    db.session.commit()
    return jsonify({'mensagem': 'Senha alterada com sucesso!'}), 200


@app.route('/api/usuarios/<int:uid>/redefinir-senha', methods=['POST'])
@admin_required
def redefinir_senha(uid):
    admin   = db.session.get(Usuario, session['usuario_id'])
    usuario = db.session.get(Usuario, uid)
    if not usuario:
        return jsonify({'erro': 'Usuario nao encontrado'}), 404
    if admin.empresa and usuario.empresa != admin.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    nova_senha = request.json.get('senha_nova', '')
    valida, erro = validar_senha_forte(nova_senha)
    if not valida:
        return jsonify({'erro': erro}), 400
    usuario.definir_senha(nova_senha)
    usuario.trocar_senha = True
    db.session.commit()
    return jsonify({'mensagem': f'Senha de {usuario.nome} redefinida.'}), 200


# ─────────────────────────────────────────
# USUARIOS
# ─────────────────────────────────────────
@app.route('/api/usuarios', methods=['GET'])
@login_required
def listar_usuarios():
    usuario = db.session.get(Usuario, session['usuario_id'])
    if usuario.empresa:
        usuarios = Usuario.query.filter_by(empresa=usuario.empresa).all()
    else:
        usuarios = Usuario.query.all()
    return jsonify([u.to_dict() for u in usuarios])


@app.route('/api/usuarios/colaborativos', methods=['GET'])
@login_required
def listar_colaborativos():
    usuario = db.session.get(Usuario, session['usuario_id'])
    if usuario.empresa:
        lista = Usuario.query.filter_by(tipo_perfil='Colaborativo', empresa=usuario.empresa).all()
    else:
        lista = Usuario.query.filter_by(tipo_perfil='Colaborativo').all()
    return jsonify([u.to_dict() for u in lista])


@app.route('/api/usuarios/admins', methods=['GET'])
@admin_required
def listar_admins():
    """Lista admins disponiveis para colaborar em tarefas (exceto o proprio logado)."""
    usuario = db.session.get(Usuario, session['usuario_id'])
    query = Usuario.query.filter(
        Usuario.tipo_perfil.in_(['Administrador', 'Admin Master']),
        Usuario.id != usuario.id
    )
    if usuario.empresa:
        query = query.filter_by(empresa=usuario.empresa)
    return jsonify([u.to_dict() for u in query.all()])


@app.route('/api/usuarios', methods=['POST'])
@admin_required
def criar_usuario():
    dados = request.json
    for campo in ['nome', 'funcao', 'email', 'tipo_perfil', 'senha']:
        if not dados.get(campo):
            return jsonify({'erro': f'Campo "{campo}" obrigatorio'}), 400

    perfis_validos = ['Colaborativo', 'Administrador', 'Admin Master']
    if dados['tipo_perfil'] not in perfis_validos:
        return jsonify({'erro': 'tipo_perfil invalido'}), 400

    # Somente Admin Master pode criar outro Admin Master
    criador = db.session.get(Usuario, session['usuario_id'])
    if dados['tipo_perfil'] == 'Admin Master' and not criador.is_master():
        return jsonify({'erro': 'Apenas Admin Master pode criar outros Admin Masters'}), 403

    # Admin Master so pode ser criado pelo email especifico
    if dados['tipo_perfil'] == 'Admin Master' and criador.email != ADMIN_MASTER_EMAIL:
        return jsonify({'erro': 'Apenas o Admin Master principal pode criar outros Admin Masters'}), 403

    valida, erro = validar_senha_forte(dados['senha'])
    if not valida:
        return jsonify({'erro': erro}), 400

    if Usuario.query.filter_by(email=dados['email'].lower()).first():
        return jsonify({'erro': 'E-mail ja cadastrado'}), 409

    empresa = criador.empresa or dados.get('empresa') or None

    novo = Usuario(
        nome=dados['nome'], funcao=dados['funcao'],
        email=dados['email'].lower(), tipo_perfil=dados['tipo_perfil'],
        trocar_senha=True, empresa=empresa,
        setor=dados.get('setor') or None
    )
    novo.definir_senha(dados['senha'])
    db.session.add(novo)
    db.session.commit()
    return jsonify(novo.to_dict()), 201


@app.route('/api/usuarios/<int:uid>', methods=['PUT'])
@master_required
def editar_usuario(uid):
    admin   = db.session.get(Usuario, session['usuario_id'])
    usuario = db.session.get(Usuario, uid)
    if not usuario:
        return jsonify({'erro': 'Usuario nao encontrado'}), 404
    if admin.empresa and usuario.empresa != admin.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403

    dados = request.json

    if 'nome'   in dados: usuario.nome   = dados['nome'].strip()
    if 'funcao' in dados: usuario.funcao = dados['funcao'].strip()
    if 'setor'  in dados: usuario.setor  = dados['setor'].strip() or None
    if 'empresa' in dados and not admin.empresa:
        usuario.empresa = dados['empresa'].strip() or None

    # Mudanca de perfil: apenas Admin Master pode alterar, e nao pode rebaixar outro Master
    if 'tipo_perfil' in dados:
        novo_perfil = dados['tipo_perfil']
        perfis_validos = ['Colaborativo', 'Administrador', 'Admin Master']
        if novo_perfil not in perfis_validos:
            return jsonify({'erro': 'tipo_perfil invalido'}), 400
        # Somente o email principal pode promover/criar Admin Master
        if novo_perfil == 'Admin Master' and admin.email != ADMIN_MASTER_EMAIL:
            return jsonify({'erro': 'Apenas o Admin Master principal pode promover outros a Admin Master'}), 403
        # Nao pode rebaixar o Admin Master principal
        if usuario.email == ADMIN_MASTER_EMAIL and novo_perfil != 'Admin Master':
            return jsonify({'erro': 'Nao e possivel alterar o perfil do Admin Master principal'}), 403
        usuario.tipo_perfil = novo_perfil

    db.session.commit()
    return jsonify(usuario.to_dict()), 200


@app.route('/api/usuarios/<int:uid>', methods=['DELETE'])
@admin_required
def excluir_usuario(uid):
    admin   = db.session.get(Usuario, session['usuario_id'])
    usuario = db.session.get(Usuario, uid)
    if not usuario:
        return jsonify({'erro': 'Usuario nao encontrado'}), 404
    if usuario.id == session['usuario_id']:
        return jsonify({'erro': 'Voce nao pode excluir a si mesmo'}), 400
    if admin.empresa and usuario.empresa != admin.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    # Admin normal nao pode excluir Admin Master
    if usuario.is_master() and not admin.is_master():
        return jsonify({'erro': 'Apenas Admin Master pode excluir outro Admin Master'}), 403
    db.session.delete(usuario)
    db.session.commit()
    return jsonify({'mensagem': 'Usuario excluido'}), 200


@app.route('/api/setores', methods=['GET'])
@login_required
def listar_setores():
    usuario = db.session.get(Usuario, session['usuario_id'])
    query   = db.session.query(Usuario.setor).filter(Usuario.setor.isnot(None))
    if usuario.empresa:
        query = query.filter(Usuario.empresa == usuario.empresa)
    setores = sorted(set(row[0] for row in query.all() if row[0]))
    return jsonify(setores)


# ─────────────────────────────────────────
# TAREFAS
# ─────────────────────────────────────────
STATUSES_VALIDOS    = ['Nao iniciado', 'Iniciado', 'Em andamento', 'Pausado', 'Aguardo retorno', 'Finalizado']
PRIORIDADES_VALIDAS = ['Nenhuma', 'Alta']


@app.route('/api/tarefas', methods=['GET'])
@login_required
def listar_tarefas():
    usuario = db.session.get(Usuario, session['usuario_id'])
    empresa = usuario.empresa
    uid     = usuario.id

    if usuario.is_master():
        # Admin Master: ve TODAS as tarefas da empresa
        query = Tarefa.query.filter(
            db.or_(Tarefa.compartilhada == True, Tarefa.criado_por == uid)
        )
        if empresa:
            query = query.filter(Tarefa.empresa == empresa)

    elif usuario.is_admin():
        # Administrador: suas proprias + admin colab + onde foi adicionado como responsavel
        query = Tarefa.query.filter(
            db.or_(
                Tarefa.criado_por == uid,
                Tarefa.codigo.in_(
                    db.session.query(tarefa_admins.c.tarefa_codigo)
                    .filter(tarefa_admins.c.usuario_id == uid)
                ),
                Tarefa.codigo.in_(
                    db.session.query(tarefa_responsaveis.c.tarefa_codigo)
                    .filter(tarefa_responsaveis.c.usuario_id == uid)
                )
            )
        )
        if empresa:
            query = query.filter(Tarefa.empresa == empresa)

    else:
        # Colaborativo: tarefas atribuidas a ele
        query = (Tarefa.query
                 .join(tarefa_responsaveis, Tarefa.codigo == tarefa_responsaveis.c.tarefa_codigo)
                 .filter(tarefa_responsaveis.c.usuario_id == uid))
        if empresa:
            query = query.filter(Tarefa.empresa == empresa)

    tarefas = query.order_by(Tarefa.codigo.desc()).all()
    return jsonify([t.to_dict(viewer_id=uid) for t in tarefas])


@app.route('/api/tarefas', methods=['POST'])
@admin_required
def criar_tarefa():
    dados = request.json
    if not dados.get('descricao'):
        return jsonify({'erro': 'Descricao obrigatoria'}), 400

    prioridade    = dados.get('prioridade', 'Nenhuma')
    compartilhada = dados.get('compartilhada', True)
    if prioridade not in PRIORIDADES_VALIDAS:
        return jsonify({'erro': 'Prioridade invalida'}), 400

    admin   = db.session.get(Usuario, session['usuario_id'])
    empresa = admin.empresa

    nova = Tarefa(
        descricao=dados['descricao'], prioridade=prioridade,
        compartilhada=compartilhada, criado_por=session['usuario_id'], empresa=empresa
    )
    db.session.add(nova)
    db.session.flush()

    # Responsaveis colaborativos
    responsaveis_novos = []
    nomes = []
    if compartilhada:
        for uid in dados.get('responsaveis_ids', []):
            u = db.session.get(Usuario, uid)
            if u and u.tipo_perfil == 'Colaborativo' and (not empresa or u.empresa == empresa):
                nova.responsaveis.append(u)
                responsaveis_novos.append(u)
                nomes.append(u.nome)

    # Admins colaboradores
    for uid in dados.get('admins_ids', []):
        u = db.session.get(Usuario, uid)
        if u and u.is_admin() and u.id != admin.id and (not empresa or u.empresa == empresa):
            nova.admins_colabs.append(u)

    msg = f'Tarefa criada por {admin.nome}.'
    if not compartilhada:
        msg += ' Tarefa pessoal.'
    elif nomes:
        msg += f' Responsaveis: {", ".join(nomes)}.'
    else:
        msg += ' Sem responsaveis.'

    registrar_historico(nova.codigo, session['usuario_id'], msg)
    db.session.commit()

    email_tarefa_criada(nova, responsaveis_novos, admin.nome, admin.email)
    return jsonify(nova.to_dict()), 201


@app.route('/api/tarefas/<int:codigo>', methods=['DELETE'])
@admin_required
def excluir_tarefa(codigo):
    tarefa = db.session.get(Tarefa, codigo)
    admin  = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa nao encontrada'}), 404
    if admin.empresa and tarefa.empresa != admin.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    # Admin normal so pode excluir suas proprias tarefas
    if not admin.is_master() and tarefa.criado_por != session['usuario_id']:
        return jsonify({'erro': 'Acesso negado'}), 403
    db.session.delete(tarefa)
    db.session.commit()
    return jsonify({'mensagem': f'Tarefa #{codigo} excluida'}), 200


@app.route('/api/tarefas/<int:codigo>/status', methods=['PATCH'])
@login_required
def atualizar_status(codigo):
    tarefa  = db.session.get(Tarefa, codigo)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa nao encontrada'}), 404
    if usuario.empresa and tarefa.empresa != usuario.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    # Colaborativo: so pode alterar se for responsavel
    if usuario.tipo_perfil == 'Colaborativo' and usuario.id not in [u.id for u in tarefa.responsaveis]:
        return jsonify({'erro': 'Acesso negado'}), 403
    # Admin normal: so pode alterar suas proprias tarefas ou onde e admin colab
    if usuario.tipo_perfil == 'Administrador':
        ids_admins_colabs = [u.id for u in tarefa.admins_colabs]
        if tarefa.criado_por != usuario.id and usuario.id not in ids_admins_colabs:
            return jsonify({'erro': 'Acesso negado'}), 403

    novo_status = request.json.get('status')
    if novo_status not in STATUSES_VALIDOS:
        return jsonify({'erro': 'Status invalido'}), 400

    anterior      = tarefa.status
    tarefa.status = novo_status
    registrar_historico(codigo, session['usuario_id'],
        f'Status alterado de "{anterior}" para "{novo_status}" por {usuario.nome}.')
    db.session.commit()

    if anterior != novo_status:
        email_status_alterado(tarefa, anterior, novo_status, usuario.nome, usuario.id)

    return jsonify(tarefa.to_dict()), 200


@app.route('/api/tarefas/<int:codigo>/prioridade', methods=['PATCH'])
@admin_required
def atualizar_prioridade(codigo):
    tarefa = db.session.get(Tarefa, codigo)
    admin  = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa nao encontrada'}), 404
    if admin.empresa and tarefa.empresa != admin.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    if not admin.is_master() and tarefa.criado_por != admin.id:
        return jsonify({'erro': 'Acesso negado'}), 403
    nova = request.json.get('prioridade')
    if nova not in PRIORIDADES_VALIDAS:
        return jsonify({'erro': 'Prioridade invalida'}), 400
    tarefa.prioridade = nova
    db.session.commit()
    return jsonify(tarefa.to_dict()), 200


@app.route('/api/tarefas/<int:codigo>/responsaveis', methods=['PUT'])
@admin_required
def atualizar_responsaveis(codigo):
    tarefa = db.session.get(Tarefa, codigo)
    admin  = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa nao encontrada'}), 404
    if admin.empresa and tarefa.empresa != admin.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    if not admin.is_master() and tarefa.criado_por != admin.id:
        return jsonify({'erro': 'Acesso negado'}), 403

    ids_antes = {u.id for u in tarefa.responsaveis}
    empresa   = admin.empresa

    tarefa.responsaveis.clear()
    nomes_depois = []
    responsaveis_novos = []
    for uid in request.json.get('responsaveis_ids', []):
        u = db.session.get(Usuario, uid)
        if u and u.tipo_perfil == 'Colaborativo' and (not empresa or u.empresa == empresa):
            tarefa.responsaveis.append(u)
            nomes_depois.append(u.nome)
            if u.id not in ids_antes:
                responsaveis_novos.append(u)

    nomes_antes_str = ', '.join(
        db.session.get(Usuario, i).nome for i in ids_antes if db.session.get(Usuario, i)
    ) or 'nenhum'
    registrar_historico(codigo, session['usuario_id'],
        f'Responsaveis alterados por {admin.nome}. Antes: {nomes_antes_str}. Agora: {", ".join(nomes_depois) or "nenhum"}.')
    db.session.commit()

    if responsaveis_novos:
        email_tarefa_atribuida(tarefa, responsaveis_novos, admin.nome)

    return jsonify(tarefa.to_dict()), 200


@app.route('/api/tarefas/<int:codigo>/admins', methods=['PUT'])
@admin_required
def atualizar_admins_colab(codigo):
    """Atualiza a lista de admins colaboradores de uma tarefa."""
    tarefa = db.session.get(Tarefa, codigo)
    admin  = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa nao encontrada'}), 404
    if admin.empresa and tarefa.empresa != admin.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    if not admin.is_master() and tarefa.criado_por != admin.id:
        return jsonify({'erro': 'Acesso negado'}), 403

    empresa = admin.empresa
    tarefa.admins_colabs.clear()
    nomes = []
    for uid in request.json.get('admins_ids', []):
        u = db.session.get(Usuario, uid)
        if u and u.is_admin() and u.id != admin.id and (not empresa or u.empresa == empresa):
            tarefa.admins_colabs.append(u)
            nomes.append(u.nome)

    registrar_historico(codigo, session['usuario_id'],
        f'Admins colaboradores atualizados por {admin.nome}: {", ".join(nomes) or "nenhum"}.')
    db.session.commit()
    return jsonify(tarefa.to_dict()), 200


# ─────────────────────────────────────────
# COMENTARIOS
# ─────────────────────────────────────────
@app.route('/api/tarefas/<int:codigo>/comentarios', methods=['GET'])
@login_required
def listar_comentarios(codigo):
    if not db.session.get(Tarefa, codigo):
        return jsonify({'erro': 'Tarefa nao encontrada'}), 404
    comentarios = (Comentario.query.filter_by(id_tarefa=codigo)
                   .order_by(Comentario.data_hora.asc()).all())
    return jsonify([c.to_dict() for c in comentarios])


@app.route('/api/tarefas/<int:codigo>/comentarios', methods=['POST'])
@login_required
def adicionar_comentario(codigo):
    tarefa  = db.session.get(Tarefa, codigo)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa nao encontrada'}), 404
    if usuario.empresa and tarefa.empresa != usuario.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403

    # Verifica acesso
    ids_resp       = [u.id for u in tarefa.responsaveis]
    ids_adm_colab  = [u.id for u in tarefa.admins_colabs]
    if usuario.tipo_perfil == 'Colaborativo' and usuario.id not in ids_resp:
        return jsonify({'erro': 'Acesso negado'}), 403
    if usuario.tipo_perfil == 'Administrador':
        if tarefa.criado_por != usuario.id and usuario.id not in ids_adm_colab:
            return jsonify({'erro': 'Acesso negado'}), 403

    texto = request.json.get('texto', '').strip()
    if not texto:
        return jsonify({'erro': 'Comentario nao pode ser vazio'}), 400

    novo = Comentario(id_tarefa=codigo, id_usuario=session['usuario_id'], texto=texto, tipo='comentario')
    db.session.add(novo)
    db.session.commit()

    email_comentario_adicionado(tarefa, texto, usuario.nome, usuario.id)
    return jsonify(novo.to_dict()), 201


# ─────────────────────────────────────────
# ANEXOS
# ─────────────────────────────────────────
def extensao_permitida(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in EXTENSOES_PERMITIDAS

def formatar_tamanho(b):
    if b < 1024: return f'{b} B'
    if b < 1024**2: return f'{b/1024:.1f} KB'
    return f'{b/1024**2:.1f} MB'


@app.route('/api/tarefas/<int:codigo>/anexos', methods=['GET'])
@login_required
def listar_anexos(codigo):
    tarefa  = db.session.get(Tarefa, codigo)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa não encontrada'}), 404
    if usuario.empresa and tarefa.empresa != usuario.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    return jsonify([a.to_dict() for a in tarefa.anexos])


@app.route('/api/tarefas/<int:codigo>/anexos', methods=['POST'])
@login_required
def upload_anexo(codigo):
    tarefa  = db.session.get(Tarefa, codigo)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa não encontrada'}), 404
    if usuario.empresa and tarefa.empresa != usuario.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403

    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400
    arquivo = request.files['arquivo']
    if arquivo.filename == '':
        return jsonify({'erro': 'Nome de arquivo vazio'}), 400
    if not extensao_permitida(arquivo.filename):
        return jsonify({'erro': 'Tipo de arquivo não permitido'}), 400

    nome_original = secure_filename(arquivo.filename)
    ext           = nome_original.rsplit('.', 1)[1].lower() if '.' in nome_original else ''
    nome_uuid     = f'{uuid.uuid4().hex}.{ext}' if ext else uuid.uuid4().hex
    caminho       = os.path.join(app.config['UPLOAD_FOLDER'], nome_uuid)
    arquivo.save(caminho)
    tamanho   = os.path.getsize(caminho)
    mime_type = mimetypes.guess_type(nome_original)[0] or 'application/octet-stream'

    novo = Anexo(
        id_tarefa=codigo, id_usuario=session['usuario_id'],
        nome_original=arquivo.filename, nome_arquivo=nome_uuid,
        tamanho=tamanho, mime_type=mime_type
    )
    db.session.add(novo)
    registrar_historico(codigo, session['usuario_id'],
        f'{usuario.nome} anexou o arquivo "{arquivo.filename}" ({formatar_tamanho(tamanho)}).')
    db.session.commit()
    return jsonify(novo.to_dict()), 201


@app.route('/api/anexos/<int:aid>/download', methods=['GET'])
@login_required
def download_anexo(aid):
    anexo   = db.session.get(Anexo, aid)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not anexo:
        return jsonify({'erro': 'Anexo não encontrado'}), 404
    tarefa = db.session.get(Tarefa, anexo.id_tarefa)
    if usuario.empresa and tarefa and tarefa.empresa != usuario.empresa:
        return jsonify({'erro': 'Acesso negado'}), 403
    caminho = os.path.join(app.config['UPLOAD_FOLDER'], anexo.nome_arquivo)
    if not os.path.exists(caminho):
        return jsonify({'erro': 'Arquivo não encontrado no servidor'}), 404
    return send_from_directory(
        app.config['UPLOAD_FOLDER'], anexo.nome_arquivo,
        download_name=anexo.nome_original, as_attachment=True
    )


@app.route('/api/anexos/<int:aid>', methods=['DELETE'])
@login_required
def excluir_anexo(aid):
    anexo   = db.session.get(Anexo, aid)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not anexo:
        return jsonify({'erro': 'Anexo não encontrado'}), 404
    # Só o uploader, o criador da tarefa ou admin master pode excluir
    tarefa = db.session.get(Tarefa, anexo.id_tarefa)
    pode = (
        anexo.id_usuario == usuario.id or
        (tarefa and tarefa.criado_por == usuario.id) or
        usuario.is_master()
    )
    if not pode:
        return jsonify({'erro': 'Acesso negado'}), 403
    caminho = os.path.join(app.config['UPLOAD_FOLDER'], anexo.nome_arquivo)
    if os.path.exists(caminho):
        os.remove(caminho)
    registrar_historico(anexo.id_tarefa, session['usuario_id'],
        f'{usuario.nome} removeu o anexo "{anexo.nome_original}".')
    db.session.delete(anexo)
    db.session.commit()
    return jsonify({'mensagem': 'Anexo excluído'}), 200


# ─────────────────────────────────────────
# RELATÓRIO DE PENDÊNCIAS
# ─────────────────────────────────────────
@app.route('/api/relatorio/pendencias', methods=['GET'])
@admin_required
def relatorio_pendencias():
    admin   = db.session.get(Usuario, session['usuario_id'])
    empresa = admin.empresa

    # Tarefas não finalizadas, filtradas por empresa
    query = Tarefa.query.filter(Tarefa.status != 'Finalizado')
    if empresa:
        query = query.filter(Tarefa.empresa == empresa)

    # Admin normal: só suas tarefas
    if not admin.is_master():
        uid = admin.id
        query = query.filter(
            db.or_(
                Tarefa.criado_por == uid,
                Tarefa.codigo.in_(
                    db.session.query(tarefa_admins.c.tarefa_codigo)
                    .filter(tarefa_admins.c.usuario_id == uid)
                ),
                Tarefa.codigo.in_(
                    db.session.query(tarefa_responsaveis.c.tarefa_codigo)
                    .filter(tarefa_responsaveis.c.usuario_id == uid)
                )
            )
        )

    tarefas_pendentes = query.order_by(Tarefa.codigo.desc()).all()

    # Agrupa por responsável
    por_usuario = {}

    for t in tarefas_pendentes:
        if not t.compartilhada:
            continue
        ids_resp = [u.id for u in t.responsaveis]
        # Tarefas sem responsável: atribui ao criador
        if not ids_resp:
            criador = db.session.get(Usuario, t.criado_por)
            if criador:
                uid = criador.id
                if uid not in por_usuario:
                    por_usuario[uid] = {'usuario': criador.to_dict(), 'tarefas': []}
                por_usuario[uid]['tarefas'].append({
                    'codigo': t.codigo,
                    'descricao': t.descricao,
                    'status': t.status,
                    'prioridade': t.prioridade,
                    'data_criacao': t.data_criacao.strftime('%d/%m/%Y'),
                    'sem_responsavel': True
                })
        else:
            for u in t.responsaveis:
                uid = u.id
                if uid not in por_usuario:
                    por_usuario[uid] = {'usuario': u.to_dict(), 'tarefas': []}
                por_usuario[uid]['tarefas'].append({
                    'codigo': t.codigo,
                    'descricao': t.descricao,
                    'status': t.status,
                    'prioridade': t.prioridade,
                    'data_criacao': t.data_criacao.strftime('%d/%m/%Y'),
                    'sem_responsavel': False
                })

    # Ordena por nome do usuário, e dentro por prioridade (Alta primeiro)
    resultado = sorted(por_usuario.values(), key=lambda x: x['usuario']['nome'])
    for item in resultado:
        item['tarefas'] = sorted(item['tarefas'], key=lambda t: (0 if t['prioridade'] == 'Alta' else 1, t['codigo']))
        item['total'] = len(item['tarefas'])

    return jsonify({
        'gerado_em': datetime.utcnow().strftime('%d/%m/%Y %H:%M'),
        'total_tarefas': len(tarefas_pendentes),
        'por_usuario': resultado
    })



if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
