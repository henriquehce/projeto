from flask import Flask, jsonify, request, render_template, session
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime
from functools import wraps
import bcrypt
import os

# Carrega variaveis do .env automaticamente (so em desenvolvimento)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─────────────────────────────────────────
# CONFIGURACAO — local vs producao
# ─────────────────────────────────────────
def get_database_url():
    url = os.environ.get('DATABASE_URL', 'sqlite:///taskflow.db')
    # Supabase/Heroku entregam 'postgres://' mas SQLAlchemy exige 'postgresql://'
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url

app = Flask(__name__)
app.config['SECRET_KEY']                     = os.environ.get('SECRET_KEY', 'taskflow-dev-secret-troque-em-producao')
app.config['SQLALCHEMY_DATABASE_URI']        = get_database_url()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Seguranca extra em producao
if os.environ.get('FLASK_ENV') == 'production':
    app.config['SESSION_COOKIE_SECURE']   = True
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

db = SQLAlchemy(app)
CORS(app)

# ─────────────────────────────────────────
# TABELA ASSOCIATIVA — Tarefa <-> Responsáveis
# ─────────────────────────────────────────
tarefa_responsaveis = db.Table('tarefa_responsaveis',
    db.Column('tarefa_codigo', db.Integer, db.ForeignKey('tarefas.codigo'), primary_key=True),
    db.Column('usuario_id',    db.Integer, db.ForeignKey('usuarios.id'),    primary_key=True)
)

# ─────────────────────────────────────────
# MIGRACAO
# ─────────────────────────────────────────
from flask_migrate import Migrate
migrate = Migrate(app, db)

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
    # Força troca de senha no primeiro acesso (quando Admin define a senha)
    trocar_senha  = db.Column(db.Boolean, default=False)
    comentarios   = db.relationship('Comentario', backref='autor', lazy=True)

    # ── helpers de senha ──
    def definir_senha(self, senha_plain):
        self.senha_hash = bcrypt.hashpw(
            senha_plain.encode('utf-8'),
            bcrypt.gensalt()
        ).decode('utf-8')

    def verificar_senha(self, senha_plain):
        return bcrypt.checkpw(
            senha_plain.encode('utf-8'),
            self.senha_hash.encode('utf-8')
        )

    def to_dict(self):
        return {
            'id':           self.id,
            'nome':         self.nome,
            'funcao':       self.funcao,
            'email':        self.email,
            'tipo_perfil':  self.tipo_perfil,
            'trocar_senha': self.trocar_senha
        }


class Tarefa(db.Model):
    __tablename__ = 'tarefas'
    codigo       = db.Column(db.Integer, primary_key=True, autoincrement=True)
    descricao    = db.Column(db.Text, nullable=False)
    data_criacao = db.Column(db.DateTime, default=datetime.utcnow)
    status       = db.Column(db.String(30), default='Não iniciado')
    responsaveis = db.relationship('Usuario', secondary=tarefa_responsaveis, lazy='subquery',
                                   backref=db.backref('tarefas_responsavel', lazy=True))
    comentarios  = db.relationship('Comentario', backref='tarefa', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'codigo':       self.codigo,
            'descricao':    self.descricao,
            'data_criacao': self.data_criacao.strftime('%d/%m/%Y %H:%M'),
            'status':       self.status,
            'responsaveis': [{'id': u.id, 'nome': u.nome, 'funcao': u.funcao} for u in self.responsaveis]
        }


class Comentario(db.Model):
    __tablename__ = 'comentarios'
    id         = db.Column(db.Integer, primary_key=True)
    id_tarefa  = db.Column(db.Integer, db.ForeignKey('tarefas.codigo'), nullable=False)
    id_usuario = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    texto      = db.Column(db.Text, nullable=False)
    tipo       = db.Column(db.String(20), default='comentario')  # 'comentario' | 'historico'
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


# ─────────────────────────────────────────
# HELPER — Histórico automático
# ─────────────────────────────────────────
def registrar_historico(id_tarefa, id_usuario, texto):
    db.session.add(Comentario(
        id_tarefa=id_tarefa,
        id_usuario=id_usuario,
        texto=texto,
        tipo='historico'
    ))


# ─────────────────────────────────────────
# DECORADORES
# ─────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({'erro': 'Não autenticado'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({'erro': 'Não autenticado'}), 401
        u = db.session.get(Usuario, session['usuario_id'])
        if not u or u.tipo_perfil != 'Administrador':
            return jsonify({'erro': 'Acesso negado. Apenas administradores.'}), 403
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────
# ROTA PRINCIPAL
# ─────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')


# ─────────────────────────────────────────
# AUTENTICAÇÃO
# ─────────────────────────────────────────

@app.route('/api/login', methods=['POST'])
def login():
    dados = request.json
    email = dados.get('email', '').strip().lower()
    senha = dados.get('senha', '')

    if not email or not senha:
        return jsonify({'erro': 'E-mail e senha são obrigatórios'}), 400

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
# TROCAR SENHA (colaborativo troca a própria)
# ─────────────────────────────────────────

@app.route('/api/trocar-senha', methods=['POST'])
@login_required
def trocar_senha():
    dados        = request.json
    senha_atual  = dados.get('senha_atual', '')
    senha_nova   = dados.get('senha_nova', '')
    senha_conf   = dados.get('senha_confirmacao', '')

    if not senha_atual or not senha_nova or not senha_conf:
        return jsonify({'erro': 'Preencha todos os campos'}), 400

    if len(senha_nova) < 6:
        return jsonify({'erro': 'A nova senha deve ter pelo menos 6 caracteres'}), 400

    if senha_nova != senha_conf:
        return jsonify({'erro': 'A confirmação de senha não confere'}), 400

    usuario = db.session.get(Usuario, session['usuario_id'])

    if not usuario.verificar_senha(senha_atual):
        return jsonify({'erro': 'Senha atual incorreta'}), 401

    usuario.definir_senha(senha_nova)
    usuario.trocar_senha = False
    db.session.commit()

    return jsonify({'mensagem': 'Senha alterada com sucesso!'}), 200


# ─────────────────────────────────────────
# REDEFINIR SENHA (Admin redefine a de outro)
# ─────────────────────────────────────────

@app.route('/api/usuarios/<int:uid>/redefinir-senha', methods=['POST'])
@admin_required
def redefinir_senha(uid):
    usuario = db.session.get(Usuario, uid)
    if not usuario:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    nova_senha = request.json.get('senha_nova', '')
    if len(nova_senha) < 6:
        return jsonify({'erro': 'A senha deve ter pelo menos 6 caracteres'}), 400

    usuario.definir_senha(nova_senha)
    usuario.trocar_senha = True   # força troca no próximo login
    db.session.commit()

    return jsonify({'mensagem': f'Senha de {usuario.nome} redefinida. Ela deverá trocá-la no próximo acesso.'}), 200


# ─────────────────────────────────────────
# USUÁRIOS
# ─────────────────────────────────────────

@app.route('/api/usuarios', methods=['GET'])
@login_required
def listar_usuarios():
    return jsonify([u.to_dict() for u in Usuario.query.all()])


@app.route('/api/usuarios/colaborativos', methods=['GET'])
@login_required
def listar_colaborativos():
    return jsonify([u.to_dict() for u in Usuario.query.filter_by(tipo_perfil='Colaborativo').all()])


@app.route('/api/usuarios', methods=['POST'])
@admin_required
def criar_usuario():
    dados = request.json
    for campo in ['nome', 'funcao', 'email', 'tipo_perfil', 'senha']:
        if not dados.get(campo):
            return jsonify({'erro': f'Campo "{campo}" obrigatório'}), 400

    if dados['tipo_perfil'] not in ['Administrador', 'Colaborativo']:
        return jsonify({'erro': 'tipo_perfil inválido'}), 400

    if len(dados['senha']) < 6:
        return jsonify({'erro': 'A senha deve ter pelo menos 6 caracteres'}), 400

    if Usuario.query.filter_by(email=dados['email'].lower()).first():
        return jsonify({'erro': 'E-mail já cadastrado'}), 409

    novo = Usuario(
        nome=dados['nome'],
        funcao=dados['funcao'],
        email=dados['email'].lower(),
        tipo_perfil=dados['tipo_perfil'],
        trocar_senha=True  # colaborativo troca no primeiro acesso
    )
    novo.definir_senha(dados['senha'])
    db.session.add(novo)
    db.session.commit()
    return jsonify(novo.to_dict()), 201


@app.route('/api/usuarios/<int:uid>', methods=['DELETE'])
@admin_required
def excluir_usuario(uid):
    usuario = db.session.get(Usuario, uid)
    if not usuario:
        return jsonify({'erro': 'Usuário não encontrado'}), 404
    if usuario.id == session['usuario_id']:
        return jsonify({'erro': 'Você não pode excluir a si mesmo'}), 400
    db.session.delete(usuario)
    db.session.commit()
    return jsonify({'mensagem': 'Usuário excluído'}), 200


# ─────────────────────────────────────────
# TAREFAS
# ─────────────────────────────────────────

@app.route('/api/tarefas', methods=['GET'])
@login_required
def listar_tarefas():
    usuario = db.session.get(Usuario, session['usuario_id'])
    if usuario.tipo_perfil == 'Administrador':
        tarefas = Tarefa.query.order_by(Tarefa.codigo.desc()).all()
    else:
        tarefas = (Tarefa.query
                   .join(tarefa_responsaveis, Tarefa.codigo == tarefa_responsaveis.c.tarefa_codigo)
                   .filter(tarefa_responsaveis.c.usuario_id == usuario.id)
                   .order_by(Tarefa.codigo.desc()).all())
    return jsonify([t.to_dict() for t in tarefas])


@app.route('/api/tarefas', methods=['POST'])
@admin_required
def criar_tarefa():
    dados = request.json
    if not dados.get('descricao'):
        return jsonify({'erro': 'Descrição obrigatória'}), 400

    nova = Tarefa(descricao=dados['descricao'])
    db.session.add(nova)
    db.session.flush()

    nomes = []
    for uid in dados.get('responsaveis_ids', []):
        u = db.session.get(Usuario, uid)
        if u and u.tipo_perfil == 'Colaborativo':
            nova.responsaveis.append(u)
            nomes.append(u.nome)

    admin = db.session.get(Usuario, session['usuario_id'])
    msg = f'Tarefa criada por {admin.nome}.'
    msg += f' Responsáveis: {", ".join(nomes)}.' if nomes else ' Sem responsáveis.'
    registrar_historico(nova.codigo, session['usuario_id'], msg)

    db.session.commit()
    return jsonify(nova.to_dict()), 201


@app.route('/api/tarefas/<int:codigo>', methods=['DELETE'])
@admin_required
def excluir_tarefa(codigo):
    tarefa = db.session.get(Tarefa, codigo)
    if not tarefa:
        return jsonify({'erro': 'Tarefa não encontrada'}), 404
    db.session.delete(tarefa)
    db.session.commit()
    return jsonify({'mensagem': f'Tarefa #{codigo} excluída'}), 200


@app.route('/api/tarefas/<int:codigo>/status', methods=['PATCH'])
@login_required
def atualizar_status(codigo):
    tarefa  = db.session.get(Tarefa, codigo)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa não encontrada'}), 404
    if usuario.tipo_perfil == 'Colaborativo' and usuario.id not in [u.id for u in tarefa.responsaveis]:
        return jsonify({'erro': 'Acesso negado'}), 403

    novo_status = request.json.get('status')
    if novo_status not in ['Não iniciado', 'Em andamento', 'Finalizado']:
        return jsonify({'erro': 'Status inválido'}), 400

    anterior      = tarefa.status
    tarefa.status = novo_status
    registrar_historico(codigo, session['usuario_id'],
        f'Status alterado de "{anterior}" para "{novo_status}" por {usuario.nome}.')
    db.session.commit()
    return jsonify(tarefa.to_dict()), 200


@app.route('/api/tarefas/<int:codigo>/responsaveis', methods=['PUT'])
@admin_required
def atualizar_responsaveis(codigo):
    tarefa = db.session.get(Tarefa, codigo)
    if not tarefa:
        return jsonify({'erro': 'Tarefa não encontrada'}), 404

    admin        = db.session.get(Usuario, session['usuario_id'])
    nomes_antes  = [u.nome for u in tarefa.responsaveis]

    tarefa.responsaveis.clear()
    nomes_depois = []
    for uid in request.json.get('responsaveis_ids', []):
        u = db.session.get(Usuario, uid)
        if u and u.tipo_perfil == 'Colaborativo':
            tarefa.responsaveis.append(u)
            nomes_depois.append(u.nome)

    registrar_historico(codigo, session['usuario_id'],
        f'Responsáveis alterados por {admin.nome}. '
        f'Antes: {", ".join(nomes_antes) or "nenhum"}. '
        f'Agora: {", ".join(nomes_depois) or "nenhum"}.')
    db.session.commit()
    return jsonify(tarefa.to_dict()), 200


# ─────────────────────────────────────────
# COMENTÁRIOS
# ─────────────────────────────────────────

@app.route('/api/tarefas/<int:codigo>/comentarios', methods=['GET'])
@login_required
def listar_comentarios(codigo):
    if not db.session.get(Tarefa, codigo):
        return jsonify({'erro': 'Tarefa não encontrada'}), 404
    comentarios = (Comentario.query.filter_by(id_tarefa=codigo)
                   .order_by(Comentario.data_hora.asc()).all())
    return jsonify([c.to_dict() for c in comentarios])


@app.route('/api/tarefas/<int:codigo>/comentarios', methods=['POST'])
@login_required
def adicionar_comentario(codigo):
    tarefa  = db.session.get(Tarefa, codigo)
    usuario = db.session.get(Usuario, session['usuario_id'])
    if not tarefa:
        return jsonify({'erro': 'Tarefa não encontrada'}), 404
    if usuario.tipo_perfil == 'Colaborativo' and usuario.id not in [u.id for u in tarefa.responsaveis]:
        return jsonify({'erro': 'Acesso negado'}), 403

    texto = request.json.get('texto', '').strip()
    if not texto:
        return jsonify({'erro': 'Comentário não pode ser vazio'}), 400

    novo = Comentario(id_tarefa=codigo, id_usuario=session['usuario_id'], texto=texto, tipo='comentario')
    db.session.add(novo)
    db.session.commit()
    return jsonify(novo.to_dict()), 201

@app.route('/setup')
def setup():
    if Usuario.query.filter_by(email='admin@taskflow.com').first():
        return 'Usuário já existe'
    u = Usuario(
        nome='Administrador',
        funcao='Admin',
        email='admin@taskflow.com',
        tipo_perfil='Administrador',
        trocar_senha=False
    )
    u.definir_senha('admin123')
    db.session.add(u)
    db.session.commit()
    return 'Usuário admin criado com sucesso!'

# ─────────────────────────────────────────
# INICIALIZAÇÃO
# ─────────────────────────────────────────

def seed_data():
    if Usuario.query.count() == 0:
        admin  = Usuario(nome='Administrador', funcao='Gestor',       email='admin@taskflow.com', tipo_perfil='Administrador', trocar_senha=False)
        colab1 = Usuario(nome='João Silva',    funcao='Desenvolvedor', email='joao@taskflow.com',  tipo_perfil='Colaborativo',  trocar_senha=True)
        colab2 = Usuario(nome='Maria Souza',   funcao='Designer',      email='maria@taskflow.com', tipo_perfil='Colaborativo',  trocar_senha=True)

        admin.definir_senha('admin123')
        colab1.definir_senha('joao123')
        colab2.definir_senha('maria123')

        db.session.add_all([admin, colab1, colab2])
        db.session.commit()

        t1 = Tarefa(descricao='Finalizar relatório de vendas do setor A', status='Em andamento')
        t2 = Tarefa(descricao='Criar protótipo da nova tela de login',    status='Não iniciado')
        t3 = Tarefa(descricao='Revisar documentação do sistema',          status='Finalizado')
        db.session.add_all([t1, t2, t3])
        db.session.flush()

        t1.responsaveis.extend([colab1, colab2])
        t2.responsaveis.append(colab2)
        t3.responsaveis.append(colab1)

        registrar_historico(t1.codigo, admin.id, f'Tarefa criada por {admin.nome}. Responsáveis: {colab1.nome}, {colab2.nome}.')
        registrar_historico(t2.codigo, admin.id, f'Tarefa criada por {admin.nome}. Responsáveis: {colab2.nome}.')
        registrar_historico(t3.codigo, admin.id, f'Tarefa criada por {admin.nome}. Responsáveis: {colab1.nome}.')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        seed_data()
    app.run(debug=True, port=5000)
