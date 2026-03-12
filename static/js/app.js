/* ═══════════════════════════════════════
   TASKFLOW — JavaScript Principal v5
═══════════════════════════════════════ */

let usuarioLogado  = null;
let todasTarefas   = [];
let filtrosAtivos   = new Set(); // vazio = todas
let buscaAtual     = '';
let tarefaAberta   = null;
let deferredPrompt = null;
let responsaveisDisponiveis = [];
let adminsDisponiveis       = [];
let tarefaEditandoResp      = null;
let ordemAtual = { coluna: null, direcao: 'asc' };

const STATUSES = [
    'Não iniciado', 'Iniciado', 'Em andamento',
    'Pausado', 'Aguardo retorno', 'Finalizado'
];
const PRIORIDADES = ['Nenhuma', 'Alta'];

// ─────────────────────────────────────────
// HELPERS DE PERFIL
// ─────────────────────────────────────────
function isAdmin()  { return usuarioLogado && (usuarioLogado.tipo_perfil === 'Administrador' || usuarioLogado.tipo_perfil === 'Admin Master'); }
function isMaster() { return usuarioLogado && usuarioLogado.tipo_perfil === 'Admin Master'; }

// ─────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await api('/api/me');
        if (res.ok) {
            usuarioLogado = await res.json();
            verificarTrocaSenha();
        }
    } catch {}

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        document.getElementById('pwa-install-btn').style.display = 'block';
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js').catch(() => {});
    }
});

// ─────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────
async function api(url, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts);
}

// ─────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────
async function realizarLogin() {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';

    if (!email || !senha) { mostrarErroLogin('Preencha e-mail e senha.'); return; }

    const btn = document.querySelector('#screen-login .btn-primary');
    btn.textContent = 'Entrando...';
    btn.disabled = true;

    try {
        const res = await api('/api/login', 'POST', { email, senha });
        if (res.ok) {
            usuarioLogado = await res.json();
            verificarTrocaSenha();
        } else {
            const err = await res.json();
            mostrarErroLogin(err.erro || 'Credenciais inválidas.');
        }
    } catch {
        mostrarErroLogin('Erro de conexão.');
    } finally {
        btn.innerHTML = 'Entrar <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
        btn.disabled = false;
    }
}

function mostrarErroLogin(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg;
    el.style.display = 'block';
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (document.getElementById('screen-login').classList.contains('active')) realizarLogin();
        if (document.getElementById('modal-comentarios').classList.contains('active') && (e.ctrlKey || e.metaKey)) enviarComentario();
    }
});

// ─────────────────────────────────────────
// VERIFICAR TROCA DE SENHA
// ─────────────────────────────────────────
function verificarTrocaSenha() {
    if (usuarioLogado.trocar_senha) {
        document.getElementById('screen-login').classList.remove('active');
        abrirModal('modal-trocar-senha');
        document.getElementById('trocar-senha-aviso').style.display = 'block';
    } else {
        entrarNoApp();
    }
}

async function fazerLogout() {
    await api('/api/logout', 'POST');
    usuarioLogado = null;
    todasTarefas  = [];
    document.getElementById('screen-app').classList.remove('active');
    document.getElementById('screen-login').classList.add('active');
    document.getElementById('login-email').value = '';
    document.getElementById('login-senha').value = '';
    document.getElementById('login-error').style.display = 'none';
    fecharUserMenu();
}

// ─────────────────────────────────────────
// VALIDAÇÃO DE SENHA FORTE
// ─────────────────────────────────────────
function validarSenhaForte(senha) {
    if (senha.length < 8)               return 'A senha deve ter pelo menos 8 caracteres.';
    if (!/[A-Z]/.test(senha))           return 'A senha deve conter pelo menos 1 letra maiúscula.';
    if (!/[a-z]/.test(senha))           return 'A senha deve conter pelo menos 1 letra minúscula.';
    if (!/\d/.test(senha))              return 'A senha deve conter pelo menos 1 número.';
    if (!/[!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/`~\\]/.test(senha))
                                        return 'A senha deve conter pelo menos 1 caractere especial.';
    return null;
}

// ─────────────────────────────────────────
// TROCAR SENHA
// ─────────────────────────────────────────
async function salvarTrocaEmail() {
    const email_novo = document.getElementById('te-email').value.trim();
    const senha      = document.getElementById('te-senha').value;
    const err        = document.getElementById('te-error');
    err.style.display = 'none';
    if (!email_novo || !senha) { err.textContent = 'Preencha todos os campos'; err.style.display = 'block'; return; }
    const res = await api('/api/trocar-email', 'POST', { email_novo, senha });
    const data = await res.json();
    if (res.ok) {
        fecharModal('modal-trocar-email');
        toast('✅ E-mail alterado com sucesso!', 'success');
        document.getElementById('menu-funcao').textContent = email_novo;
    } else {
        err.textContent = data.erro || 'Erro ao alterar e-mail';
        err.style.display = 'block';
    }
}

async function salvarTrocaSenha() {
    const atual = document.getElementById('ts-atual').value;
    const nova  = document.getElementById('ts-nova').value;
    const conf  = document.getElementById('ts-conf').value;
    const errEl = document.getElementById('ts-error');
    errEl.style.display = 'none';

    if (!atual || !nova || !conf) { errEl.textContent = 'Preencha todos os campos.'; errEl.style.display = 'block'; return; }
    const erroSenha = validarSenhaForte(nova);
    if (erroSenha) { errEl.textContent = erroSenha; errEl.style.display = 'block'; return; }
    if (nova !== conf) { errEl.textContent = 'As senhas não conferem.'; errEl.style.display = 'block'; return; }

    const res = await api('/api/trocar-senha', 'POST', { senha_atual: atual, senha_nova: nova, senha_confirmacao: conf });
    if (res.ok) {
        usuarioLogado.trocar_senha = false;
        fecharModal('modal-trocar-senha');
        limparCamposTrocaSenha();
        toast('✅ Senha alterada com sucesso!', 'success');
        if (!document.getElementById('screen-app').classList.contains('active')) entrarNoApp();
    } else {
        const err = await res.json();
        errEl.textContent = err.erro || 'Erro ao trocar senha.';
        errEl.style.display = 'block';
    }
}

function limparCamposTrocaSenha() {
    ['ts-atual','ts-nova','ts-conf'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ts-error').style.display = 'none';
    document.getElementById('trocar-senha-aviso').style.display = 'none';
}

// ─────────────────────────────────────────
// REDEFINIR SENHA (Admin)
// ─────────────────────────────────────────
let usuarioRedefinindo = null;

function abrirModalRedefinirSenha(uid, nome) {
    usuarioRedefinindo = uid;
    document.getElementById('rd-titulo').textContent = `Redefinir senha — ${nome}`;
    document.getElementById('rd-nova').value = '';
    document.getElementById('rd-conf').value = '';
    document.getElementById('rd-error').style.display = 'none';
    abrirModal('modal-redefinir-senha');
}

async function salvarRedefinicaoSenha() {
    const nova  = document.getElementById('rd-nova').value;
    const conf  = document.getElementById('rd-conf').value;
    const errEl = document.getElementById('rd-error');
    errEl.style.display = 'none';

    if (!nova || !conf) { errEl.textContent = 'Preencha os dois campos.'; errEl.style.display = 'block'; return; }
    const erroSenha = validarSenhaForte(nova);
    if (erroSenha) { errEl.textContent = erroSenha; errEl.style.display = 'block'; return; }
    if (nova !== conf) { errEl.textContent = 'As senhas não conferem.'; errEl.style.display = 'block'; return; }

    const res = await api(`/api/usuarios/${usuarioRedefinindo}/redefinir-senha`, 'POST', { senha_nova: nova });
    if (res.ok) {
        fecharModal('modal-redefinir-senha');
        toast('✅ Senha redefinida!', 'success');
    } else {
        const err = await res.json();
        errEl.textContent = err.erro || 'Erro ao redefinir.';
        errEl.style.display = 'block';
    }
}

// ─────────────────────────────────────────
// ENTRAR NO APP
// ─────────────────────────────────────────
function entrarNoApp() {
    const admin  = isAdmin();
    const master = isMaster();
    document.getElementById('screen-login').classList.remove('active');
    document.getElementById('screen-app').classList.add('active');

    const badge = document.getElementById('header-badge');
    if (master) {
        badge.textContent = 'Admin Master';
        badge.className   = 'perfil-badge master';
    } else if (admin) {
        badge.textContent = 'Admin';
        badge.className   = 'perfil-badge admin';
    } else {
        badge.textContent = 'Colaborativo';
        badge.className   = 'perfil-badge colab';
    }

    document.getElementById('avatar-initials').textContent = iniciais(usuarioLogado.nome);
    document.getElementById('menu-nome').textContent       = usuarioLogado.nome;
    document.getElementById('menu-funcao').textContent     = usuarioLogado.funcao;

    document.getElementById('btn-nova-tarefa').style.display     = admin ? 'flex'        : 'none';
    document.getElementById('nav-usuarios-item').style.display   = admin ? 'block'       : 'none';
    document.getElementById('nav-dashboard-item').style.display  = admin ? 'block'       : 'none';
    document.getElementById('nav-lixeira-item').style.display    = admin ? 'block'       : 'none';
    document.getElementById('btn-relatorio').style.display       = admin ? 'inline-flex' : 'none';

    navTo('tarefas');
    carregarTarefas();
}

// ─────────────────────────────────────────
// NAVEGAÇÃO
// ─────────────────────────────────────────
function navTo(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageName).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navEl = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if (navEl) navEl.classList.add('active');
    toggleSidebar(false);
    if (pageName === 'usuarios')   carregarUsuarios();
    if (pageName === 'dashboard')  carregarDashboard();
    if (pageName === 'lixeira')    carregarLixeira();
}

// ─────────────────────────────────────────
// SIDEBAR & USER MENU
// ─────────────────────────────────────────
function toggleSidebar(forceClose = null) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen  = sidebar.classList.contains('open');
    const close   = forceClose === true || (forceClose === null && isOpen);
    sidebar.classList.toggle('open', !close);
    overlay.classList.toggle('active', !close);
}

function toggleUserMenu() {
    const menu = document.getElementById('user-menu');
    menu.style.display = menu.style.display !== 'none' ? 'none' : 'block';
}

function fecharUserMenu() {
    document.getElementById('user-menu').style.display = 'none';
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#avatar-btn') && !e.target.closest('#user-menu')) fecharUserMenu();
});

// ─────────────────────────────────────────
// TAREFAS — CARREGAR
// ─────────────────────────────────────────
async function carregarTarefas() {
    try {
        const res = await api('/api/tarefas');
        if (res.ok) {
            todasTarefas = await res.json();
            const total  = todasTarefas.length;
            const admin  = isAdmin();
            document.getElementById('tarefas-sub').textContent = admin
                ? `${total} tarefa${total !== 1 ? 's' : ''} no total`
                : `${total} tarefa${total !== 1 ? 's' : ''} atribuída${total !== 1 ? 's' : ''} a você`;
            renderizarTarefas();
        }
    } catch { toast('Erro ao carregar tarefas', 'error'); }
}

// ─────────────────────────────────────────
// TAREFAS — FILTRAR
// ─────────────────────────────────────────
function getTarefasFiltradas() {
    let lista = filtrosAtivos.size === 0
        ? todasTarefas
        : todasTarefas.filter(t => filtrosAtivos.has(t.status));
    if (buscaAtual.trim()) {
        const q = buscaAtual.trim().toLowerCase();
        lista = lista.filter(t =>
            t.descricao.toLowerCase().includes(q) ||
            (t.responsaveis || []).some(r => r.nome.toLowerCase().includes(q))
        );
    }
    if (ordemAtual.coluna) {
        lista = [...lista].sort((a, b) => {
            let va, vb;
            switch (ordemAtual.coluna) {
                case 'responsavel': va = (a.responsaveis[0]?.nome || '').toLowerCase(); vb = (b.responsaveis[0]?.nome || '').toLowerCase(); break;
                case 'descricao':   va = a.descricao.toLowerCase(); vb = b.descricao.toLowerCase(); break;
                case 'data':        va = a.codigo; vb = b.codigo; break;
                case 'prioridade': { const ord = { 'Alta': 2, 'Nenhuma': 1 }; va = ord[a.prioridade] || 0; vb = ord[b.prioridade] || 0; break; }
                case 'status':      va = STATUSES.indexOf(a.status); vb = STATUSES.indexOf(b.status); break;
                default: return 0;
            }
            if (va < vb) return ordemAtual.direcao === 'asc' ? -1 : 1;
            if (va > vb) return ordemAtual.direcao === 'asc' ? 1 : -1;
            return 0;
        });
    }
    return lista;
}

function ordenarPor(coluna) {
    if (ordemAtual.coluna === coluna) {
        ordemAtual.direcao = ordemAtual.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        ordemAtual.coluna = coluna;
        ordemAtual.direcao = 'asc';
    }
    renderizarTarefas();
}

function filtrarStatus(status, btn) {
    if (status === 'todos') {
        // Se "Todas" já está ativo (todos selecionados), limpa tudo → mostra todas
        if (filtrosAtivos.size === 0) {
            // já está mostrando tudo, não faz nada
        } else {
            filtrosAtivos.clear();
        }
    } else {
        if (filtrosAtivos.has(status)) {
            filtrosAtivos.delete(status); // deseleciona
        } else {
            filtrosAtivos.add(status);    // acumula
        }
    }
    // Atualiza visual dos chips
    document.querySelectorAll('.filter-chip').forEach(c => {
        const s = c.getAttribute('data-status');
        if (s === 'todos') {
            c.classList.toggle('active', filtrosAtivos.size === 0);
        } else {
            c.classList.toggle('active', filtrosAtivos.has(s));
        }
    });
    renderizarTarefas();
}

function buscarTarefas(valor) {
    buscaAtual = valor;
    renderizarTarefas();
}

// ─────────────────────────────────────────
// TAREFAS — RENDERIZAR
// ─────────────────────────────────────────
function renderizarTarefas() {
    const grid  = document.getElementById('tasks-grid');
    const empty = document.getElementById('tasks-empty');
    const filtradas = getTarefasFiltradas();

    if (!filtradas.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const admin    = isAdmin();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        grid.className = 'tasks-grid';
        grid.innerHTML = filtradas.map(t => renderCard(t, admin)).join('');
    } else {
        grid.className = 'tasks-table-wrap';
        const th = (label, col) => {
            const ativo = ordemAtual.coluna === col;
            const seta  = ativo ? (ordemAtual.direcao === 'asc' ? ' ↑' : ' ↓') : ' ↕';
            const estilo = ativo ? 'color:var(--accent)' : 'color:var(--text-dim)';
            return `<th class="th-sort" onclick="ordenarPor('${col}')" style="cursor:pointer;user-select:none">
                ${label}<span style="font-size:11px;${estilo}">${seta}</span>
            </th>`;
        };
        grid.innerHTML = `
        <table class="tasks-table">
            <thead><tr>
                ${th('Responsável','responsavel')}
                ${th('Tarefa','descricao')}
                ${th('Criação','data')}
                ${th('Prioridade','prioridade')}
                ${th('Status','status')}
                <th style="width:100px">Ações</th>
            </tr></thead>
            <tbody>${filtradas.map(t => renderLinha(t, admin)).join('')}</tbody>
        </table>`;
    }
}

function renderCard(t, admin) {
    const cls     = statusClass(t.status);
    const podEditar = admin && t.compartilhada && t.responsaveis && t.responsaveis.length > 0 && (isMaster() || t.criado_por === usuarioLogado.id);
    const podExcluir = admin && (isMaster() || t.criado_por === usuarioLogado.id);

    // Badge de admins colaboradores
    const adminsColab = (t.admins_colabs || []);
    const adminsHtml  = adminsColab.length
        ? `<span style="font-size:11px;color:var(--text-dim)" title="${escapar(adminsColab.map(a=>a.nome).join(', '))}">👥 +${adminsColab.length} admin${adminsColab.length>1?'s':''}</span>`
        : '';

    return `
    <div class="task-card status-${cls}" ondblclick="abrirModalComentarios(${t.codigo})">
        <div class="task-meta">
            <span class="task-code">#${String(t.codigo).padStart(4,'0')}</span>
            <span class="task-date">${t.data_criacao}</span>
            ${badgePrioridade(t.prioridade)}
            ${!t.compartilhada ? '<span class="badge-pessoal">🔒 Pessoal</span>' : ''}
        </div>
        <div class="task-perspectiva">${badgesPerspectiva(t)}</div>
        <p class="task-desc">${escapar(t.descricao)}</p>
        ${badgeChecklist(t)}
        <div class="task-responsaveis">
            ${renderResponsaveisAvatares(t.responsaveis, t.admins_colabs)}
            ${podEditar ? `<button class="btn-edit-resp" onclick="event.stopPropagation();abrirModalResponsaveis(${t.codigo})" title="Editar responsáveis">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg></button>` : ''}
        </div>
        <div class="task-footer">
            <select class="task-status-select" onchange="alterarStatus(${t.codigo},this.value)" onclick="event.stopPropagation()">
                ${STATUSES.map(s => `<option ${t.status===s?'selected':''}>${s}</option>`).join('')}
            </select>
            <div style="display:flex;gap:5px;align-items:center">
                <button class="action-btn action-comentar" style="width:28px;height:28px;border-radius:6px" onclick="event.stopPropagation();abrirModalComentarios(${t.codigo})" title="Comentários">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button class="action-btn action-checklist" style="width:28px;height:28px;border-radius:6px" onclick="event.stopPropagation();abrirModalChecklist(${t.codigo})" title="Checklist">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    ${t.checklist_total > 0 ? `<span class="action-badge ${t.checklist_concluidos===t.checklist_total?'green':'blue'}" style="font-size:8px;min-width:13px;height:13px">${t.checklist_concluidos}/${t.checklist_total}</span>` : ''}
                </button>
                <button class="action-btn action-anexos" style="width:28px;height:28px;border-radius:6px" onclick="event.stopPropagation();abrirModalAnexos(${t.codigo})" title="Arquivos">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    ${t.anexos_count > 0 ? `<span class="action-badge blue" style="font-size:8px;min-width:13px;height:13px">${t.anexos_count}</span>` : ''}
                </button>
                ${podExcluir ? `<button class="action-btn action-delete" style="width:28px;height:28px;border-radius:6px" onclick="event.stopPropagation();confirmarExcluirTarefa(${t.codigo})" title="Excluir">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>` : ''}
            </div>
        </div>
    </div>`;
}

function renderLinha(t, admin) {
    const todosResp = [
        ...(t.responsaveis || []).map(r => ({ ...r, tipo: 'resp' })),
        ...(t.admins_colabs || []).map(a => ({ ...a, tipo: 'admin' }))
    ];
    const nomes = todosResp.length
        ? todosResp.map(r => `<span class="table-resp-chip${r.tipo === 'admin' ? ' table-resp-chip-admin' : ''}">${escapar(iniciais(r.nome))}</span>`).join('')
        : `<span class="sem-responsavel">${!t.compartilhada ? '🔒 Pessoal' : '—'}</span>`;

    const podEditar  = admin && t.compartilhada && t.responsaveis && t.responsaveis.length > 0 && (isMaster() || t.criado_por === usuarioLogado.id);
    const podExcluir = admin && (isMaster() || t.criado_por === usuarioLogado.id);

    return `
    <tr class="task-row" ondblclick="abrirModalComentarios(${t.codigo})">
        <td class="td-resp">${nomes}</td>
        <td class="td-desc">
            <span class="table-desc">${escapar(t.descricao)}</span>
            ${!t.compartilhada ? '<span class="badge-pessoal">Pessoal</span>' : ''}
            ${badgesPerspectiva(t)}
            ${badgeChecklist(t)}
        </td>
        <td class="td-date" style="white-space:nowrap">${t.data_criacao}</td>
        <td class="td-prio">${badgePrioridade(t.prioridade)}</td>
        <td class="td-status">
            <select class="task-status-select compact" onchange="alterarStatus(${t.codigo},this.value)" onclick="event.stopPropagation()">
                ${STATUSES.map(s => `<option ${t.status===s?'selected':''}>${s}</option>`).join('')}
            </select>
        </td>
        ${admin ? `<td class="td-actions" onclick="event.stopPropagation()">
            <button class="action-btn action-comentar" onclick="abrirModalComentarios(${t.codigo})" title="Comentários">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button class="action-btn action-checklist" onclick="abrirModalChecklist(${t.codigo})" title="Checklist">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                ${t.checklist_total > 0 ? `<span class="action-badge ${t.checklist_concluidos===t.checklist_total ? 'green' : 'blue'}">${t.checklist_concluidos}/${t.checklist_total}</span>` : ''}
            </button>
            <button class="action-btn action-anexos" onclick="abrirModalAnexos(${t.codigo})" title="Arquivos">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                ${t.anexos_count > 0 ? `<span class="action-badge blue">${t.anexos_count}</span>` : ''}
            </button>
            ${podEditar ? `<button class="action-btn action-resp" onclick="abrirModalResponsaveis(${t.codigo})" title="Responsáveis">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </button>` : ''}
            ${podExcluir ? `<button class="action-btn action-delete" onclick="confirmarExcluirTarefa(${t.codigo})" title="Excluir">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>` : ''}
        </td>` : `<td class="td-actions" onclick="event.stopPropagation()">
            <button class="action-btn action-comentar" onclick="abrirModalComentarios(${t.codigo})" title="Comentários">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button class="action-btn action-checklist" onclick="abrirModalChecklist(${t.codigo})" title="Checklist">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                ${t.checklist_total > 0 ? `<span class="action-badge ${t.checklist_concluidos===t.checklist_total ? 'green' : 'blue'}">${t.checklist_concluidos}/${t.checklist_total}</span>` : ''}
            </button>
            <button class="action-btn action-anexos" onclick="abrirModalAnexos(${t.codigo})" title="Arquivos">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                ${t.anexos_count > 0 ? `<span class="action-badge blue">${t.anexos_count}</span>` : ''}
            </button>
        </td>`}
    </tr>`;
}

function badgePrioridade(p) {
    if (p !== 'Alta') return '';
    return `<span class="badge-prio prio-alta">↑ Alta</span>`;
}

function badgesPerspectiva(t) {
    let html = '';
    if (t.delegada && t.compartilhada && t.responsaveis && t.responsaveis.length > 0) html += `<span class="badge-perspectiva badge-delegada" title="Tarefa que você criou e delegou">↑ Delegada</span>`;
    if (t.comigo)   html += `<span class="badge-perspectiva badge-comigo"   title="Tarefa atribuída a você para executar">↓ Comigo</span>`;
    return html;
}

function renderResponsaveisAvatares(responsaveis, admins_colabs) {
    const todos = [
        ...(responsaveis || []).map(r => ({ ...r, tipo: 'resp' })),
        ...(admins_colabs || []).map(a => ({ ...a, tipo: 'admin' }))
    ];
    if (!todos.length) return `<span class="sem-responsavel">Sem responsável</span>`;
    const vis    = todos.slice(0, 3);
    const extras = todos.length - 3;
    const nomes  = todos.map(r => r.nome).join(', ');
    return `<div class="resp-group" title="${escapar(nomes)}">
        ${vis.map(r => `<div class="resp-avatar${r.tipo === 'admin' ? ' resp-avatar-admin' : ''}">${iniciais(r.nome)}</div>`).join('')}
        ${extras > 0 ? `<div class="resp-avatar resp-extra">+${extras}</div>` : ''}
    </div>`;
}

window.addEventListener('resize', () => {
    if (todasTarefas.length) renderizarTarefas();
});

// ─────────────────────────────────────────
// SELETOR DE RESPONSÁVEIS (colaborativos)
// ─────────────────────────────────────────
function renderSeletorResponsaveis(containerId, selecionados = []) {
    const container = document.getElementById(containerId);
    if (!responsaveisDisponiveis.length) {
        container.innerHTML = '<p style="color:var(--text-dim);font-size:13px;text-align:center;padding:20px">Nenhum colaborativo cadastrado.</p>';
        return;
    }
    container.innerHTML = responsaveisDisponiveis.map(r => {
        const marcado = selecionados.includes(r.id);
        return `
        <label class="resp-checkbox ${marcado ? 'checked' : ''}" data-id="${r.id}">
            <input type="checkbox" value="${r.id}" ${marcado ? 'checked' : ''} onchange="toggleResponsavelCheck(this)">
            <div class="resp-check-avatar">${iniciais(r.nome)}</div>
            <div class="resp-check-info">
                <span class="resp-check-nome">${escapar(r.nome)}</span>
                <span class="resp-check-funcao">${escapar(r.funcao)}</span>
            </div>
            <div class="resp-check-mark">✓</div>
        </label>`;
    }).join('');
}

// ─────────────────────────────────────────
// SELETOR DE ADMINS COLABORADORES
// ─────────────────────────────────────────
function renderSeletorAdmins(containerId, selecionados = []) {
    const container = document.getElementById(containerId);
    if (!adminsDisponiveis.length) {
        container.innerHTML = '<p style="color:var(--text-dim);font-size:13px;text-align:center;padding:12px">Nenhum outro administrador cadastrado.</p>';
        return;
    }
    // Admins já na tarefa primeiro, depois os demais
    const ordenados = [
        ...adminsDisponiveis.filter(a => selecionados.includes(a.id)),
        ...adminsDisponiveis.filter(a => !selecionados.includes(a.id))
    ];
    container.innerHTML = ordenados.map(a => {
        const marcado = selecionados.includes(a.id);
        const badge   = a.tipo_perfil === 'Admin Master' ? ' 👑' : '';
        const naTarefa = marcado ? `<span style="font-size:10px;font-weight:700;background:rgba(124,58,237,0.15);color:#a78bfa;border:1px solid rgba(124,58,237,0.3);border-radius:999px;padding:2px 8px;white-space:nowrap">Na tarefa</span>` : '';
        return `
        <label class="resp-checkbox resp-checkbox-admin ${marcado ? 'checked' : ''}" data-id="${a.id}">
            <input type="checkbox" value="${a.id}" ${marcado ? 'checked' : ''} onchange="toggleResponsavelCheck(this)">
            <div class="resp-check-avatar resp-check-avatar-admin">${iniciais(a.nome)}</div>
            <div class="resp-check-info">
                <span class="resp-check-nome">${escapar(a.nome)}${badge}</span>
                <span class="resp-check-funcao">${escapar(a.funcao)}</span>
            </div>
            ${naTarefa}
            <div class="resp-check-mark">✓</div>
        </label>`;
    }).join('');
}

function toggleResponsavelCheck(checkbox) {
    checkbox.closest('label').classList.toggle('checked', checkbox.checked);
}

function getResponsaveisSelecionados(containerId) {
    return [...document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)].map(el => parseInt(el.value));
}

// ─────────────────────────────────────────
// CRIAR TAREFA
// ─────────────────────────────────────────
async function abrirModalNovaTarefa() {
    const [resColabs, resAdmins] = await Promise.all([
        api('/api/usuarios/colaborativos'),
        api('/api/usuarios/admins')
    ]);
    if (resColabs.ok) responsaveisDisponiveis = await resColabs.json();
    if (resAdmins.ok) adminsDisponiveis       = await resAdmins.json();

    document.getElementById('nova-tarefa-desc').value = '';
    document.getElementById('nova-tarefa-prio').value = 'Nenhuma';
    renderSeletorResponsaveis('responsaveis-criar', []);
    renderSeletorAdmins('admins-criar', []);
    abrirModal('modal-nova-tarefa');
}

async function criarTarefa() {
    const descricao        = document.getElementById('nova-tarefa-desc').value.trim();
    const prioridade       = document.getElementById('nova-tarefa-prio').value;
    const responsaveis_ids = getResponsaveisSelecionados('responsaveis-criar');
    const admins_ids       = getResponsaveisSelecionados('admins-criar');
    // Compartilhada automaticamente se tiver responsáveis ou admins colaboradores
    const compartilhada    = responsaveis_ids.length > 0 || admins_ids.length > 0;

    if (!descricao) { toast('Informe uma descrição', 'error'); return; }

    const res = await api('/api/tarefas', 'POST', { descricao, prioridade, compartilhada, responsaveis_ids, admins_ids });
    if (res.ok) { fecharModal('modal-nova-tarefa'); toast('✅ Tarefa criada!', 'success'); carregarTarefas(); }
    else { const e = await res.json(); toast(e.erro || 'Erro ao criar', 'error'); }
}

// ─────────────────────────────────────────
// EDITAR RESPONSÁVEIS
// ─────────────────────────────────────────
async function abrirModalResponsaveis(codigo) {
    tarefaEditandoResp = codigo;
    const tarefa = todasTarefas.find(t => t.codigo === codigo);

    const [resColabs, resAdmins] = await Promise.all([
        api('/api/usuarios/colaborativos'),
        api('/api/usuarios/admins')
    ]);
    if (resColabs.ok) responsaveisDisponiveis = await resColabs.json();
    if (resAdmins.ok) adminsDisponiveis       = await resAdmins.json();

    document.getElementById('modal-resp-titulo').textContent = `Responsáveis — Tarefa #${String(codigo).padStart(4,'0')}`;

    const selColabs = tarefa ? tarefa.responsaveis.map(r => r.id)    : [];
    const selAdmins = tarefa ? (tarefa.admins_colabs || []).map(a => a.id) : [];

    renderSeletorResponsaveis('responsaveis-editar', selColabs);
    renderSeletorAdmins('admins-editar', selAdmins);
    abrirModal('modal-responsaveis');
}

async function salvarResponsaveis() {
    const idsColabs = getResponsaveisSelecionados('responsaveis-editar');
    const idsAdmins = getResponsaveisSelecionados('admins-editar');

    const [r1, r2] = await Promise.all([
        api(`/api/tarefas/${tarefaEditandoResp}/responsaveis`, 'PUT', { responsaveis_ids: idsColabs }),
        api(`/api/tarefas/${tarefaEditandoResp}/admins`,        'PUT', { admins_ids: idsAdmins })
    ]);

    if (r1.ok && r2.ok) { fecharModal('modal-responsaveis'); toast('✅ Atualizado!', 'success'); carregarTarefas(); }
    else { const e = await (r1.ok ? r2 : r1).json(); toast(e.erro || 'Erro', 'error'); }
}

// ─────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────
async function alterarStatus(codigo, novoStatus) {
    const res  = await api(`/api/tarefas/${codigo}/status`, 'PATCH', { status: novoStatus });
    if (res.ok) {
        const idx = todasTarefas.findIndex(t => t.codigo === codigo);
        if (idx !== -1) todasTarefas[idx].status = novoStatus;
        renderizarTarefas();
        toast('Status atualizado', 'success');
    } else {
        const data = await res.json().catch(() => ({}));
        if (data.bloqueado) {
            toast('⛔ ' + data.erro, 'error');
        } else {
            toast('❌ ' + (data.erro || 'Erro ao atualizar status'), 'error');
        }
        carregarTarefas();
    }
}

// ─────────────────────────────────────────
// EXCLUIR TAREFA
// ─────────────────────────────────────────
function confirmarExcluirTarefa(codigo) {
    if (confirm(`Excluir tarefa #${String(codigo).padStart(4,'0')}? Esta ação não pode ser desfeita.`))
        excluirTarefa(codigo);
}

async function excluirTarefa(codigo) {
    const res = await api(`/api/tarefas/${codigo}`, 'DELETE');
    if (res.ok) { toast('Tarefa excluída', 'success'); carregarTarefas(); }
    else toast('Erro ao excluir', 'error');
}

// ─────────────────────────────────────────
// COMENTÁRIOS
// ─────────────────────────────────────────
async function abrirModalComentarios(codigo) {
    tarefaAberta = codigo;
    const tarefa = todasTarefas.find(t => t.codigo === codigo);
    document.getElementById('comentario-titulo').textContent = `Tarefa #${String(codigo).padStart(4,'0')}`;
    document.getElementById('comentario-desc').textContent   = tarefa ? tarefa.descricao : '';
    document.getElementById('novo-comentario-texto').value   = '';
    await carregarComentarios(codigo);
    abrirModal('modal-comentarios');
}

async function carregarComentarios(codigo) {
    const res  = await api(`/api/tarefas/${codigo}/comentarios`);
    const area = document.getElementById('comments-area');
    if (!res.ok) return;
    const itens = await res.json();
    if (!itens.length) { area.innerHTML = '<p class="comments-empty">Nenhum comentário ainda.</p>'; return; }
    area.innerHTML = itens.map(c => {
        if (c.tipo === 'historico') return `
            <div class="historico-item">
                <div class="historico-icon">⚡</div>
                <div class="historico-body">
                    <p class="historico-texto">${escapar(c.texto)}</p>
                    <span class="comment-date">${c.data_hora}</span>
                </div>
            </div>`;
        const cls = c.autor_perfil === 'Admin Master' ? 'master' : c.autor_perfil === 'Administrador' ? 'admin' : 'colab';
        return `
            <div class="comment-item">
                <p class="comment-text">${escapar(c.texto)}</p>
                <div class="comment-meta">
                    <span class="comment-author ${cls}">${escapar(c.autor_nome)}</span>
                    <span>·</span>
                    <span class="comment-date">${c.data_hora}</span>
                </div>
            </div>`;
    }).join('');
    area.scrollTop = area.scrollHeight;
}

async function enviarComentario() {
    const texto = document.getElementById('novo-comentario-texto').value.trim();
    if (!texto) { toast('Escreva um comentário', 'error'); return; }
    const res = await api(`/api/tarefas/${tarefaAberta}/comentarios`, 'POST', { texto });
    if (res.ok) {
        document.getElementById('novo-comentario-texto').value = '';
        await carregarComentarios(tarefaAberta);
        toast('Comentário enviado!', 'success');
    } else { const e = await res.json(); toast(e.erro || 'Erro', 'error'); }
}

// ─────────────────────────────────────────
// TEMA (DARK / LIGHT)
// ─────────────────────────────────────────
function toggleTema() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('taskflow-tema', isLight ? 'light' : 'dark');
    atualizarIconeTema(isLight);
}

function atualizarIconeTema(isLight) {
    document.getElementById('theme-icon-moon').style.display = isLight ? 'none'  : 'block';
    document.getElementById('theme-icon-sun').style.display  = isLight ? 'block' : 'none';
    document.getElementById('theme-label').textContent       = isLight ? 'Escuro' : 'Claro';
}

// Restaura tema salvo ao carregar
(function() {
    const tema = localStorage.getItem('taskflow-tema');
    if (tema === 'light') {
        document.body.classList.add('light-mode');
        // Ícone será atualizado depois que o DOM carregar
        document.addEventListener('DOMContentLoaded', () => atualizarIconeTema(true));
    }
})();


const SETORES_PREDEFINIDOS = [
    'TI', 'QA', 'Direção', 'Marketing', 'Comercial / Vendas',
    'RH', 'Financeiro', 'Contabilidade', 'Jurídico', 'Logística',
    'Operações', 'Compras', 'Suporte / Atendimento', 'Produção',
    'Almoxarifado', 'Segurança', 'Administrativo', 'Outro'
];

function renderSelectSetor(selectId, valorAtual = '') {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">— Selecione o setor —</option>` +
        SETORES_PREDEFINIDOS.map(s =>
            `<option value="${s}" ${valorAtual === s ? 'selected' : ''}>${s}</option>`
        ).join('');
}


async function carregarUsuarios() {
    const res = await api('/api/usuarios');
    if (!res.ok) return;
    const usuarios = await res.json();
    document.getElementById('usuarios-list').innerHTML = usuarios.map(u => {
        const master = u.tipo_perfil === 'Admin Master';
        const admin  = u.tipo_perfil === 'Administrador';
        const badgeClass = master ? 'master' : admin ? 'admin' : 'colab';
        const podExcluir = u.id !== usuarioLogado.id && (isMaster() || (!master && !admin));
        return `
        <div class="usuario-card">
            <div class="usuario-info">
                <div class="usuario-avatar">${iniciais(u.nome)}</div>
                <div>
                    <p class="usuario-nome">${escapar(u.nome)}</p>
                    <p class="usuario-email">${escapar(u.email)}</p>
                    <p class="usuario-funcao">${escapar(u.funcao)}${u.setor ? ' · ' + escapar(u.setor) : ''}</p>
                </div>
            </div>
            <div class="usuario-acoes">
                <span class="perfil-badge ${badgeClass}">${u.tipo_perfil}</span>
                ${u.trocar_senha ? '<span class="badge-senha">🔑 Troca pendente</span>' : ''}
                ${u.tarefas_ativas > 0 ? `<span style="font-size:11px;background:var(--accent);color:#fff;padding:2px 8px;border-radius:999px;font-weight:600">${u.tarefas_ativas} tarefa${u.tarefas_ativas !== 1 ? 's' : ''}</span>` : ''}
                <button class="btn-ghost btn-sm" onclick="abrirModalRedefinirSenha(${u.id}, '${escapar(u.nome)}')" title="Redefinir senha">
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg> Senha
                </button>
                ${isMaster() && u.id !== usuarioLogado.id ? `<button class="btn-ghost btn-sm" onclick="abrirModalEditarUsuario(${u.id})" title="Editar usuário">
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg> Editar
                </button>` : ''}
                <button class="btn-ghost btn-sm" onclick="abrirLogAcessos(${u.id}, '${escapar(u.nome)}')" title="Ver log de acessos">
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Acessos
                </button>
                ${podExcluir
                    ? `<button class="btn-icon" onclick="confirmarExcluirUsuario(${u.id},'${escapar(u.nome)}')" title="Excluir">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                        </svg></button>`
                    : '<span style="font-size:12px;color:var(--text-dim)">Você</span>'}
            </div>
        </div>`;
    }).join('');
}

function abrirModalNovoUsuario() {
    ['nu-nome','nu-funcao','nu-email','nu-senha'].forEach(id => document.getElementById(id).value = '');
    renderSelectSetor('nu-setor', '');
    // Admin normal nao pode criar Admin Master
    const select = document.getElementById('nu-perfil');
    select.innerHTML = `
        <option value="Colaborativo">Colaborativo</option>
        <option value="Administrador">Administrador</option>
        ${isMaster() ? '<option value="Admin Master">Admin Master</option>' : ''}
    `;
    select.value = 'Colaborativo';
    const strength = document.getElementById('nu-strength');
    if (strength) strength.style.display = 'none';
    abrirModal('modal-novo-usuario');
}

async function criarUsuario() {
    const nome        = document.getElementById('nu-nome').value.trim();
    const funcao      = document.getElementById('nu-funcao').value.trim();
    const email       = document.getElementById('nu-email').value.trim();
    const tipo_perfil = document.getElementById('nu-perfil').value;
    const senha       = document.getElementById('nu-senha').value;
    const setor       = document.getElementById('nu-setor')?.value || '';

    if (!nome || !funcao || !email || !senha) { toast('Preencha todos os campos', 'error'); return; }
    const erroSenha = validarSenhaForte(senha);
    if (erroSenha) { toast(erroSenha, 'error'); return; }

    const res = await api('/api/usuarios', 'POST', { nome, funcao, email, tipo_perfil, senha, setor });
    if (res.ok) { fecharModal('modal-novo-usuario'); toast('✅ Usuário cadastrado!', 'success'); carregarUsuarios(); }
    else { const e = await res.json(); toast(e.erro || 'Erro', 'error'); }
}

// ─────────────────────────────────────────
// EDITAR USUÁRIO (Admin Master)
// ─────────────────────────────────────────
let usuarioEditando = null;

function abrirModalEditarUsuario(uid) {
    usuarioEditando = uid;

    // Busca dados frescos do servidor
    api('/api/usuarios').then(res => res.json()).then(lista => {
        const u = lista.find(x => x.id === uid);
        if (!u) return;

        document.getElementById('eu-nome').value   = u.nome;
        document.getElementById('eu-funcao').value = u.funcao;
        document.getElementById('eu-email').textContent = u.email;
        renderSelectSetor('eu-setor', u.setor || '');

        const select = document.getElementById('eu-perfil');
        const podePromorMaster = (usuarioLogado.email === 'henriquecipriani@gmail.com');
        select.innerHTML = `
            <option value="Colaborativo"   ${u.tipo_perfil==='Colaborativo'  ?'selected':''}>Colaborativo</option>
            <option value="Administrador"  ${u.tipo_perfil==='Administrador' ?'selected':''}>Administrador</option>
            ${podePromorMaster ? `<option value="Admin Master" ${u.tipo_perfil==='Admin Master'?'selected':''}>Admin Master</option>` : ''}
        `;

        document.getElementById('eu-titulo').textContent = `Editar — ${u.nome}`;
        document.getElementById('eu-error').style.display = 'none';
        abrirModal('modal-editar-usuario');
    });
}

async function salvarEdicaoUsuario() {
    const nome        = document.getElementById('eu-nome').value.trim();
    const funcao      = document.getElementById('eu-funcao').value.trim();
    const setor       = document.getElementById('eu-setor')?.value || '';
    const tipo_perfil = document.getElementById('eu-perfil').value;
    const errEl       = document.getElementById('eu-error');
    errEl.style.display = 'none';

    if (!nome || !funcao) {
        errEl.textContent = 'Nome e cargo são obrigatórios.';
        errEl.style.display = 'block';
        return;
    }

    const res = await api(`/api/usuarios/${usuarioEditando}`, 'PUT', { nome, funcao, setor, tipo_perfil });
    if (res.ok) {
        fecharModal('modal-editar-usuario');
        toast('✅ Usuário atualizado!', 'success');
        carregarUsuarios();
    } else {
        const e = await res.json();
        errEl.textContent = e.erro || 'Erro ao salvar.';
        errEl.style.display = 'block';
    }
}

function confirmarExcluirUsuario(id, nome) {
    if (confirm(`Excluir "${nome}"?`)) excluirUsuario(id);
}

async function excluirUsuario(id) {
    const res = await api(`/api/usuarios/${id}`, 'DELETE');
    if (res.ok) { toast('Usuário excluído', 'success'); carregarUsuarios(); }
    else { const e = await res.json(); toast(e.erro || 'Erro ao excluir', 'error'); }
}

function badgeChecklist(t) {
    if (!t.checklist_total) return '';
    const pct  = Math.round((t.checklist_concluidos / t.checklist_total) * 100);
    const cor  = pct === 100 ? '#22c55e' : pct > 0 ? '#3b82f6' : '#64748b';
    return `
    <div class="checklist-mini" onclick="event.stopPropagation();abrirModalChecklist(${t.codigo})" title="Checklist — clique para abrir">
        <div class="checklist-mini-bar-wrap">
            <div class="checklist-mini-bar" style="width:${pct}%;background:${cor}"></div>
        </div>
        <span class="checklist-mini-label" style="color:${cor}">${t.checklist_concluidos}/${t.checklist_total}</span>
    </div>`;
}

// ─────────────────────────────────────────
// CHECKLIST
// ─────────────────────────────────────────
async function abrirModalChecklist(codigo) {
    tarefaAberta = codigo;
    const tarefa = todasTarefas.find(t => t.codigo === codigo);
    document.getElementById('checklist-titulo').textContent = `Checklist — Tarefa #${String(codigo).padStart(4,'0')}`;
    document.getElementById('checklist-desc').textContent   = tarefa ? tarefa.descricao : '';
    document.getElementById('novo-item-texto').value        = '';
    document.getElementById('checklist-add-wrap').style.display = isAdmin() ? 'flex' : 'none';
    await carregarChecklist(codigo);
    abrirModal('modal-checklist');
}

async function carregarChecklist(codigo) {
    const res  = await api(`/api/tarefas/${codigo}/checklist`);
    if (!res.ok) return;
    const itens = await res.json();
    renderChecklist(itens);
}

function renderChecklist(itens) {
    const area = document.getElementById('checklist-lista');
    if (!itens.length) {
        area.innerHTML = '<p class="comments-empty">Nenhum item no checklist ainda.</p>';
        atualizarProgressoChecklist(0, 0);
        return;
    }
    const total     = itens.length;
    const concluidos = itens.filter(i => i.concluido).length;
    atualizarProgressoChecklist(concluidos, total);

    area.innerHTML = itens.map(item => {
        const podeDel    = isAdmin();
        const podeMarcar = true; // frontend sempre mostra, backend valida
        return `
        <div class="checklist-item ${item.concluido ? 'concluido' : ''}" id="ci-${item.id}">
            <label class="ci-check-wrap" onclick="toggleChecklistItem(${item.id}, ${!item.concluido})">
                <div class="ci-checkbox ${item.concluido ? 'checked' : ''}">
                    ${item.concluido ? '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                </div>
            </label>
            <div class="ci-body">
                <span class="ci-texto">${escapar(item.texto)}</span>
                ${item.concluido && item.observacao ? `<p class="ci-obs">💬 ${escapar(item.observacao)}</p>` : ''}
                ${item.concluido && item.concluido_por_nome ? `<span class="ci-meta">✓ ${escapar(item.concluido_por_nome)} · ${item.concluido_em}</span>` : ''}
                ${!item.concluido && item.criado_por_nome ? `<span class="ci-meta">Adicionado por ${escapar(item.criado_por_nome)}</span>` : ''}
            </div>
            ${podeDel ? `<button class="btn-icon btn-icon-danger ci-del" onclick="removerItemChecklist(${item.id})" title="Remover item">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                </svg>
            </button>` : ''}
        </div>`;
    }).join('');
}

function atualizarProgressoChecklist(concluidos, total) {
    const wrap = document.getElementById('checklist-progresso-wrap');
    if (!total) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    const pct = Math.round((concluidos / total) * 100);
    const cor = pct === 100 ? '#22c55e' : pct > 0 ? '#3b82f6' : '#64748b';
    document.getElementById('checklist-bar').style.width      = pct + '%';
    document.getElementById('checklist-bar').style.background = cor;
    document.getElementById('checklist-pct').textContent      = `${concluidos} de ${total} (${pct}%)`;
    document.getElementById('checklist-pct').style.color      = cor;
}

async function adicionarItemChecklist() {
    const input = document.getElementById('novo-item-texto');
    const texto = input.value.trim();
    if (!texto) { toast('Digite o texto do item', 'error'); return; }
    const res = await api(`/api/tarefas/${tarefaAberta}/checklist`, 'POST', { texto });
    if (res.ok) {
        input.value = '';
        await carregarChecklist(tarefaAberta);
        carregarTarefas();
    } else {
        const e = await res.json();
        toast(e.erro || 'Erro ao adicionar', 'error');
    }
}

// Modal intermediário para pedir observação ao marcar como concluído
let checklistItemPendente = null;

async function toggleChecklistItem(itemId, concluindo) {
    if (concluindo) {
        // Abre mini-modal para observação opcional
        checklistItemPendente = itemId;
        document.getElementById('obs-texto').value = '';
        abrirModal('modal-obs-checklist');
    } else {
        // Desmarca direto, sem observação
        await _marcarItem(itemId, false, '');
    }
}

async function confirmarObsChecklist() {
    const obs = document.getElementById('obs-texto').value.trim();
    fecharModal('modal-obs-checklist');
    await _marcarItem(checklistItemPendente, true, obs);
    checklistItemPendente = null;
}

async function pularObsChecklist() {
    fecharModal('modal-obs-checklist');
    await _marcarItem(checklistItemPendente, true, '');
    checklistItemPendente = null;
}

async function _marcarItem(itemId, concluido, observacao) {
    const res = await api(`/api/checklist/${itemId}/marcar`, 'PATCH', { concluido, observacao });
    if (res.ok) {
        await carregarChecklist(tarefaAberta);
        carregarTarefas();
    } else {
        const e = await res.json();
        toast(e.erro || 'Erro ao atualizar item', 'error');
    }
}

async function removerItemChecklist(itemId) {
    if (!confirm('Remover este item do checklist?')) return;
    const res = await api(`/api/checklist/${itemId}`, 'DELETE');
    if (res.ok) {
        await carregarChecklist(tarefaAberta);
        carregarTarefas();
    } else {
        const e = await res.json();
        toast(e.erro || 'Erro ao remover', 'error');
    }
}


async function abrirModalAnexos(codigo) {
    tarefaAberta = codigo;
    const tarefa = todasTarefas.find(t => t.codigo === codigo);
    document.getElementById('anexos-titulo').textContent = `Arquivos — Tarefa #${String(codigo).padStart(4,'0')}`;
    document.getElementById('anexo-input').value = '';
    document.getElementById('anexo-progresso').style.display = 'none';
    await carregarAnexos(codigo);
    abrirModal('modal-anexos');
}

async function carregarAnexos(codigo) {
    const res  = await api(`/api/tarefas/${codigo}/anexos`);
    const area = document.getElementById('anexos-lista');
    if (!res.ok) return;
    const itens = await res.json();
    if (!itens.length) {
        area.innerHTML = '<p class="comments-empty">Nenhum arquivo anexado.</p>';
        return;
    }
    area.innerHTML = itens.map(a => {
        const icone = iconePorMime(a.mime_type);
        const podeDel = isMaster() || (usuarioLogado && a.uploader_nome === usuarioLogado.nome);
        return `
        <div class="anexo-item" id="anexo-${a.id}">
            <div class="anexo-icon">${icone}</div>
            <div class="anexo-info">
                <a href="${a.url_download}" class="anexo-nome" download>${escapar(a.nome_original)}</a>
                <span class="anexo-meta">${formataBytes(a.tamanho)} · ${a.data_upload} · ${escapar(a.uploader_nome)}</span>
            </div>
            ${podeDel ? `<button class="btn-icon btn-icon-danger" onclick="excluirAnexo(${a.id})" title="Excluir">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                </svg>
            </button>` : ''}
        </div>`;
    }).join('');
}

async function enviarAnexo() {
    const input   = document.getElementById('anexo-input');
    const arquivo = input.files[0];
    if (!arquivo) { toast('Selecione um arquivo', 'error'); return; }

    const MAX = 25 * 1024 * 1024;
    if (arquivo.size > MAX) { toast('Arquivo muito grande (máx. 25MB)', 'error'); return; }

    const prog = document.getElementById('anexo-progresso');
    prog.style.display = 'block';
    prog.textContent   = 'Enviando…';

    const formData = new FormData();
    formData.append('arquivo', arquivo);

    try {
        const res = await fetch(`/api/tarefas/${tarefaAberta}/anexos`, {
            method: 'POST', body: formData, credentials: 'same-origin'
        });
        if (res.ok) {
            input.value = '';
            prog.style.display = 'none';
            toast('✅ Arquivo enviado!', 'success');
            await carregarAnexos(tarefaAberta);
            carregarTarefas();
        } else {
            const e = await res.json();
            prog.textContent = e.erro || 'Erro ao enviar';
            toast(e.erro || 'Erro ao enviar', 'error');
        }
    } catch {
        prog.textContent = 'Erro de conexão';
        toast('Erro de conexão', 'error');
    }
}

async function excluirAnexo(aid) {
    if (!confirm('Excluir este arquivo?')) return;
    const res = await api(`/api/anexos/${aid}`, 'DELETE');
    if (res.ok) { toast('Arquivo excluído', 'success'); await carregarAnexos(tarefaAberta); carregarTarefas(); }
    else { const e = await res.json(); toast(e.erro || 'Erro', 'error'); }
}

function iconePorMime(mime) {
    if (!mime) return '📄';
    if (mime.includes('pdf'))   return '📕';
    if (mime.includes('word') || mime.includes('document')) return '📘';
    if (mime.includes('excel') || mime.includes('spreadsheet') || mime.includes('csv')) return '📗';
    if (mime.includes('powerpoint') || mime.includes('presentation')) return '📙';
    if (mime.includes('image')) return '🖼️';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '🗜️';
    if (mime.includes('video')) return '🎬';
    return '📄';
}

function formataBytes(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1024/1024).toFixed(1)} MB`;
}

// ─────────────────────────────────────────
// LOG DE ACESSOS
// ─────────────────────────────────────────
let logAcessosUid = null;
let logAcessosNome = '';

async function abrirLogAcessos(uid, nome) {
    logAcessosUid  = uid;
    logAcessosNome = nome;
    document.getElementById('log-acessos-nome').textContent = nome;
    // Limpa filtros de data
    const de  = document.getElementById('log-de');
    const ate = document.getElementById('log-ate');
    if (de)  de.value  = '';
    if (ate) ate.value = '';
    abrirModal('modal-log-acessos');
    await _carregarLogAcessos();
}

async function _carregarLogAcessos() {
    document.getElementById('log-acessos-corpo').innerHTML =
        '<p style="text-align:center;color:var(--text-dim);padding:30px">Carregando…</p>';

    const de  = document.getElementById('log-de')?.value  || '';
    const ate = document.getElementById('log-ate')?.value || '';
    let url = `/api/usuarios/${logAcessosUid}/acessos`;
    const params = [];
    if (de)  params.push(`de=${de}`);
    if (ate) params.push(`ate=${ate}`);
    if (params.length) url += '?' + params.join('&');

    const res = await api(url);
    const corpo = document.getElementById('log-acessos-corpo');
    if (!res.ok) { corpo.innerHTML = '<p style="color:var(--error);padding:20px">Erro ao carregar.</p>'; return; }
    const logs = await res.json();
    if (!logs.length) {
        corpo.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:30px">Nenhum acesso no período.</p>';
        return;
    }
    corpo.innerHTML = logs.map(l => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px">
                <svg width="14" height="14" fill="none" stroke="var(--accent)" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span style="font-size:14px">${l.data_hora}</span>
            </div>
        </div>`).join('');
}

// ─────────────────────────────────────────
// RELATÓRIO DE PENDÊNCIAS
// ─────────────────────────────────────────
let dadosRelatorioCompleto = null;

async function abrirRelatorio() {
    abrirModal('modal-relatorio');
    document.getElementById('relatorio-corpo').innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:40px">Carregando…</p>';
    document.getElementById('relatorio-filtro-usuario').innerHTML = '<option value="">— Todos</option>';

    const res = await api('/api/relatorio/pendencias');
    if (!res.ok) { toast('Erro ao gerar relatório', 'error'); return; }
    dadosRelatorioCompleto = await res.json();

    // Popula o filtro com as pessoas que têm pendências
    const sel = document.getElementById('relatorio-filtro-usuario');
    dadosRelatorioCompleto.por_usuario.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.usuario.id;
        opt.textContent = `${item.usuario.nome} (${item.total})`;
        sel.appendChild(opt);
    });

    renderizarRelatorio(dadosRelatorioCompleto);
}

function aplicarFiltroRelatorio() {
    if (!dadosRelatorioCompleto) return;
    const uid = parseInt(document.getElementById('relatorio-filtro-usuario').value) || null;
    if (!uid) {
        renderizarRelatorio(dadosRelatorioCompleto);
    } else {
        const filtrado = {
            ...dadosRelatorioCompleto,
            por_usuario: dadosRelatorioCompleto.por_usuario.filter(i => i.usuario.id === uid)
        };
        renderizarRelatorio(filtrado);
    }
}

function renderizarRelatorio(dados) {
    const corpo = document.getElementById('relatorio-corpo');
    if (!dados.por_usuario.length) {
        corpo.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:40px">🎉 Nenhuma pendência em aberto!</p>';
        return;
    }

    const STATUS_COR = {
        'Não iniciado': '#94a3b8', 'Iniciado': '#3b82f6', 'Em andamento': '#8b5cf6',
        'Pausado': '#f59e0b', 'Aguardo retorno': '#f97316', 'Finalizado': '#22c55e'
    };

    corpo.innerHTML = `
        <div class="relatorio-header-info">
            <span>Gerado em: <strong>${dados.gerado_em}</strong></span>
            <span>Total de pendências: <strong>${dados.total_tarefas}</strong></span>
        </div>
        ${dados.por_usuario.map(item => `
        <div class="relatorio-pessoa">
            <div class="relatorio-pessoa-header">
                <div class="resp-avatar" style="width:36px;height:36px;font-size:14px">${iniciais(item.usuario.nome)}</div>
                <div>
                    <strong>${escapar(item.usuario.nome)}</strong>
                    <span style="color:var(--text-dim);font-size:12px"> · ${escapar(item.usuario.funcao)}${item.usuario.setor ? ' / ' + escapar(item.usuario.setor) : ''}</span>
                </div>
                <span class="badge-relatorio-total">${item.total} pendência${item.total !== 1 ? 's' : ''}</span>
            </div>
            <table class="relatorio-table">
                <thead><tr>
                    <th>#</th><th>Descrição</th><th>Status</th><th>Prioridade</th><th>Criação</th>
                </tr></thead>
                <tbody>
                ${item.tarefas.map(t => `
                    <tr>
                        <td style="color:var(--text-dim);font-size:12px">#${String(t.codigo).padStart(4,'0')}</td>
                        <td>${escapar(t.descricao)}</td>
                        <td><span style="color:${STATUS_COR[t.status]||'#94a3b8'};font-size:12px;font-weight:600">${t.status}</span></td>
                        <td>${t.prioridade === 'Alta' ? '<span class="badge-prio prio-alta">↑ Alta</span>' : '<span style="color:var(--text-dim);font-size:12px">—</span>'}</td>
                        <td style="color:var(--text-dim);font-size:12px;white-space:nowrap">${t.data_criacao}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`).join('')}
    `;
}

function imprimirRelatorio() {
    // Safari/macOS fix: remove overflow:hidden do body antes de imprimir
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'visible';
    window.print();
    // Restaura após impressão
    setTimeout(() => { document.body.style.overflow = prevOverflow; }, 500);
}

function exportarRelatorioExcel() {
    const uid = document.getElementById('relatorio-filtro-usuario')?.value || '';
    const url = uid ? `/api/relatorio/excel?usuario_id=${uid}` : '/api/relatorio/excel';
    window.location.href = url;
}

// ─────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────
async function carregarDashboard() {
    const res = await api('/api/dashboard');
    if (!res.ok) return;
    const d = await res.json();

    const STATUS_COR = {
        'Não iniciado': '#94a3b8', 'Iniciado': '#3b82f6', 'Em andamento': '#8b5cf6',
        'Pausado': '#f59e0b', 'Aguardo retorno': '#f97316', 'Finalizado': '#22c55e'
    };

    document.getElementById('dash-total').textContent      = d.total;
    document.getElementById('dash-pendentes').textContent  = d.pendentes;
    document.getElementById('dash-finalizadas').textContent = d.finalizadas;
    document.getElementById('dash-alta').textContent       = d.alta_prioridade;

    // Barras de status
    const barras = document.getElementById('dash-barras');
    barras.innerHTML = Object.entries(d.por_status).map(([s, n]) => {
        const pct = d.total > 0 ? Math.round((n / d.total) * 100) : 0;
        return `
        <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                <span style="color:${STATUS_COR[s]};font-weight:600">${s}</span>
                <span style="color:var(--text-dim)">${n} (${pct}%)</span>
            </div>
            <div style="height:8px;background:var(--surface2);border-radius:999px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${STATUS_COR[s]};border-radius:999px;transition:width 0.6s ease"></div>
            </div>
        </div>`;
    }).join('');

    // Tarefas recentes
    const recentes = document.getElementById('dash-recentes');
    recentes.innerHTML = d.recentes.length ? d.recentes.map(t => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="navTo('tarefas')">
            <span style="font-size:11px;color:var(--text-dim);min-width:40px">#${String(t.codigo).padStart(4,'0')}</span>
            <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapar(t.descricao)}</span>
            <span style="font-size:11px;color:${STATUS_COR[t.status]};font-weight:600;white-space:nowrap">${t.status}</span>
        </div>`).join('') : '<p style="color:var(--text-dim);font-size:13px">Nenhuma tarefa.</p>';

    // Gráfico de criações por dia (SVG simples)
    const maxVal = Math.max(...d.criacoes_por_dia.map(x => x.total), 1);
    const labels = d.criacoes_por_dia;
    const grafH  = 80;
    const grafW  = 460;
    const barW   = Math.floor(grafW / labels.length) - 3;
    const svgBars = labels.map((item, i) => {
        const h = item.total > 0 ? Math.max(4, Math.round((item.total / maxVal) * grafH)) : 2;
        const x = i * (barW + 3);
        return `<g>
            <rect x="${x}" y="${grafH - h}" width="${barW}" height="${h}" rx="3"
                  fill="${item.total > 0 ? 'var(--accent)' : 'var(--border)'}" opacity="0.85"/>
            ${item.total > 0 ? `<text x="${x + barW/2}" y="${grafH - h - 4}" text-anchor="middle" font-size="9" fill="var(--text-dim)">${item.total}</text>` : ''}
            <text x="${x + barW/2}" y="${grafH + 12}" text-anchor="middle" font-size="8" fill="var(--text-dim)">${item.dia}</text>
        </g>`;
    }).join('');
    document.getElementById('dash-grafico').innerHTML =
        `<svg viewBox="0 0 ${grafW} ${grafH + 18}" width="100%" preserveAspectRatio="none">${svgBars}</svg>`;
}

// ─────────────────────────────────────────
// LIXEIRA
// ─────────────────────────────────────────
async function carregarLixeira() {
    const res = await api('/api/tarefas/lixeira');
    if (!res.ok) return;
    const tarefas = await res.json();
    const container = document.getElementById('lixeira-list');
    if (!tarefas.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:40px">🗑️ Lixeira vazia.</p>';
        return;
    }
    container.innerHTML = tarefas.map(t => {
        const podPermanente = isMaster() || t.criado_por === usuarioLogado.id;
        return `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <span style="font-size:11px;color:var(--text-dim)">#${String(t.codigo).padStart(4,'0')}</span>
                    <span style="font-size:11px;color:var(--yellow)">🗑️ Excluída em ${escapar(t.deletado_em || '')}</span>
                </div>
                <p style="margin:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapar(t.descricao)}</p>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0">
                <button class="btn-ghost btn-sm" onclick="restaurarTarefa(${t.codigo})">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    Restaurar
                </button>
                ${podPermanente ? `<button class="btn-icon" onclick="excluirPermanente(${t.codigo})" style="color:var(--red)" title="Excluir permanentemente">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function restaurarTarefa(codigo) {
    const res = await api(`/api/tarefas/${codigo}/restaurar`, 'POST');
    if (res.ok) { toast('✅ Tarefa restaurada!', 'success'); carregarLixeira(); }
    else { const e = await res.json(); toast(e.erro || 'Erro', 'error'); }
}

async function excluirPermanente(codigo) {
    if (!confirm('Excluir permanentemente? Esta ação não pode ser desfeita.')) return;
    const res = await api(`/api/tarefas/${codigo}/permanente`, 'DELETE');
    if (res.ok) { toast('Tarefa excluída permanentemente', 'success'); carregarLixeira(); }
    else { const e = await res.json(); toast(e.erro || 'Erro', 'error'); }
}


function abrirModal(id) {
    document.getElementById(id).classList.add('active');
    document.body.style.overflow = 'hidden';
}

function fecharModal(id) {
    if (id === 'modal-trocar-senha' && usuarioLogado && usuarioLogado.trocar_senha) return;
    document.getElementById(id).classList.remove('active');
    document.body.style.overflow = '';
}

function fecharModalSeFora(event, id) {
    if (event.target.id === id) fecharModal(id);
}

// ─────────────────────────────────────────
// PWA
// ─────────────────────────────────────────
async function instalarPWA() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { toast('✅ App instalado!', 'success'); document.getElementById('pwa-install-btn').style.display = 'none'; }
    deferredPrompt = null;
}

// ─────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────
function toggleSenhaVisivel(inputId, btn) {
    const input = document.getElementById(inputId);
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    btn.style.color = mostrar ? 'var(--accent)' : 'var(--text-dim)';
}

function iniciais(nome) {
    if (!nome) return '?';
    return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function escapar(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusClass(s) {
    const mapa = {
        'Não iniciado': 'nao', 'Iniciado': 'iniciado', 'Em andamento': 'andamento',
        'Pausado': 'pausado', 'Aguardo retorno': 'aguardo', 'Finalizado': 'finalizado'
    };
    return mapa[s] || 'nao';
}

function toast(msg, tipo = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = `toast ${tipo}`;
    el.style.display = 'flex';
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}