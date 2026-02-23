# TaskFlow — Sistema de Controle de Tarefas PWA

Sistema completo com perfis Administrador e Colaborativo, construído com Flask + PWA.

---

## 🚀 Como Rodar Localmente

### 1. Pré-requisitos
- Python 3.10 ou superior
- pip

### 2. Instalar dependências
```bash
pip install -r requirements.txt
```

### 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite o .env se necessário
```

### 4. Rodar o servidor
```bash
python app.py
```

### 5. Acessar
Abra o navegador em: **http://localhost:5000**

---

## 📁 Estrutura do Projeto

```
taskflow/
├── app.py                  # Backend Flask (API + rotas)
├── requirements.txt        # Dependências Python
├── Procfile                # Para deploy no Render/Railway
├── .env.example            # Exemplo de variáveis de ambiente
├── templates/
│   └── index.html          # Interface principal (PWA)
└── static/
    ├── css/
    │   └── style.css       # Estilos
    ├── js/
    │   └── app.js          # Lógica frontend
    ├── sw.js               # Service Worker (PWA)
    ├── manifest.json       # Manifest PWA
    └── icons/
        ├── icon-192.png    # Ícone do app (192x192)
        └── icon-512.png    # Ícone do app (512x512)
```

---

## 🌐 Deploy Gratuito

### Opção 1: Render (Recomendado)
1. Crie conta em render.com
2. New → Web Service → conecte seu GitHub
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `gunicorn app:app`
5. Adicione a variável DATABASE_URL nas Environment Variables

### Opção 2: Railway
1. Crie conta em railway.app
2. New Project → Deploy from GitHub
3. Adicione um banco PostgreSQL ao projeto
4. Configure DATABASE_URL automaticamente

---

## 📱 Instalar como PWA
1. Acesse o sistema pelo Chrome (Android) ou Safari (iOS)
2. Um banner "Adicionar à tela inicial" aparecerá automaticamente
3. Ou use o botão "Instalar App" no menu lateral

---

## ⚙️ Banco de Dados

O sistema suporta:
- **SQLite** — padrão para desenvolvimento local (sem configuração)
- **PostgreSQL** — recomendado para produção
- **MySQL** — alternativa (adicione `pymysql` ao requirements.txt)

Configure via variável `DATABASE_URL` no arquivo `.env`.

---

## 🔐 Segurança

- Autenticação via sessão do servidor (Flask session)
- Validação de perfil em todas as rotas protegidas
- Colaborativo só acessa suas próprias tarefas
- Deleção e criação restritas ao Administrador

> ⚠️ **Para produção real:** Adicione senhas/hash (bcrypt), HTTPS obrigatório, e tokens CSRF.
