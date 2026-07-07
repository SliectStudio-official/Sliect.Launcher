// ========== Sliect Launcher — 项目管理模块 ==========
// 负责：侧边栏项目列表、项目网格、项目详情、项目/分组 CRUD、进程操作

import {
    state, esc, toast, showConfirm, showDialog,
    getTypeInfo, getStatusLabel, formatUptime,
    setBtnLoading, setImmediateStatus,
} from './core.js';
import { getAPI } from './api-bridge.js';
import { loadLogs } from './logviewer.js';

// ========== 侧边栏渲染 ==========
export function renderSidebar() {
    const container = document.getElementById('sidebar-projects');
    if (!container) return;
    const query = state.searchQuery.toLowerCase();

    const grouped = {};
    const ungrouped = [];

    for (const p of state.projects) {
        if (query && !p.name.toLowerCase().includes(query) && !p.id.toLowerCase().includes(query)) continue;
        if (p.groupId && state.groups.find(g => g.id === p.groupId)) {
            if (!grouped[p.groupId]) grouped[p.groupId] = [];
            grouped[p.groupId].push(p);
        } else {
            ungrouped.push(p);
        }
    }

    let html = '';

    for (const g of state.groups) {
        const items = grouped[g.id] || [];
        if (items.length === 0 && query) continue;
        const collapsed = state.collapsedGroups[g.id] ? 'collapsed' : '';
        html += `<div class="project-group ${collapsed}" data-group="${esc(g.id)}">
            <div class="project-group-header">
                <svg class="group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                <span class="group-name">${esc(g.name)}</span>
                <span class="group-count">${items.length}</span>
                <div class="group-actions">
                    <button data-action="start-group" data-gid="${esc(g.id)}" title="启动分组">▶</button>
                    <button data-action="stop-group" data-gid="${esc(g.id)}" title="停止分组">⏹</button>
                    <button data-action="delete-group" data-gid="${esc(g.id)}" title="删除分组">×</button>
                </div>
            </div>
            <div class="project-group-items">
                ${items.map(p => renderProjectItem(p)).join('')}
            </div>
        </div>`;
    }

    if (ungrouped.length > 0) {
        if (state.groups.length > 0) {
            html += `<div class="project-group" data-group="__ungrouped">
                <div class="project-group-header">
                    <svg class="group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    <span class="group-name">未分组</span>
                    <span class="group-count">${ungrouped.length}</span>
                </div>
                <div class="project-group-items">
                    ${ungrouped.map(p => renderProjectItem(p)).join('')}
                </div>
            </div>`;
        } else {
            html += ungrouped.map(p => renderProjectItem(p)).join('');
        }
    }

    if (state.projects.length === 0) {
        html = `<div class="empty-state" style="padding:30px 10px">
            <p style="font-size:12px;color:var(--fg-muted)">还没有项目</p>
            <p style="font-size:11px;color:var(--fg-weak)">点击上方"添加项目"开始</p>
        </div>`;
    }

    container.innerHTML = html;
}

function renderProjectItem(p) {
    const active = state.selectedProjectId === p.id ? 'active' : '';
    const statusClass = p.status || 'stopped';
    return `<div class="project-item ${active}" data-project-id="${esc(p.id)}">
        <span class="status-dot ${statusClass}"></span>
        <span class="project-item-name">${esc(p.name)}</span>
        ${p.port ? `<span class="project-item-port">:${p.port}</span>` : ''}
    </div>`;
}

// ========== 项目网格（项目管理页 / 仪表盘概览） ==========
export function renderProjectGrid() {
    const grid = document.getElementById('project-grid');
    if (!grid) return;
    if (state.projects.length === 0) {
        grid.innerHTML = `<div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            <span class="empty-state-title">还没有项目</span>
            <span class="empty-state-desc">点击侧边栏"添加项目"或使用快捷键开始管理你的项目</span>
        </div>`;
        return;
    }

    grid.innerHTML = state.projects.map(p => {
        const statusClass = p.status || 'stopped';
        const typeInfo = getTypeInfo(p.type);
        const isRunning = statusClass === 'running';

        return `<div class="project-card" data-card-id="${esc(p.id)}">
            <div class="project-card-header">
                <span class="status-dot project-card-status ${statusClass}"></span>
                <span class="project-card-name">${esc(p.name)}</span>
                <span class="project-card-type ${typeInfo.cls}">${typeInfo.label}</span>
            </div>
            <div class="project-card-meta">
                ${p.port ? `<span class="project-card-meta-item">
                    <svg class="project-card-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
                    :${p.port}
                </span>` : ''}
                <span class="project-card-meta-item">
                    <svg class="project-card-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    PID ${p.pid || '—'}
                </span>
            </div>
            <div class="project-card-actions">
                ${!isRunning ? `<button class="btn btn-success btn-xs" data-action="start" data-id="${esc(p.id)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    启动
                </button>` : ''}
                ${isRunning ? `<button class="btn btn-ghost btn-xs" data-action="stop" data-id="${esc(p.id)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                    停止
                </button>
                <button class="btn btn-ghost btn-xs" data-action="restart" data-id="${esc(p.id)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    重启
                </button>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ========== 项目详情 ==========
export async function selectProject(id) {
    state.selectedProjectId = id;
    showView('project');
    renderSidebar();
    await renderProjectDetail();
}

export async function renderProjectDetail() {
    const p = state.projects.find(x => x.id === state.selectedProjectId);
    if (!p) { showView('dashboard'); return; }

    document.getElementById('detail-name').textContent = p.name;

    const statusBadge = document.getElementById('detail-status');
    const statusClass = p.status || 'stopped';
    statusBadge.className = 'detail-status-badge ' + statusClass;
    statusBadge.innerHTML = `<span class="status-dot ${statusClass}"></span><span>${getStatusLabel(statusClass)}</span>`;

    document.getElementById('btn-detail-start').style.display = statusClass === 'running' ? 'none' : '';
    document.getElementById('btn-detail-stop').style.display = statusClass === 'running' ? '' : 'none';
    document.getElementById('btn-detail-restart').style.display = statusClass === 'running' ? '' : 'none';

    const cmdBar = document.getElementById('log-command-bar');
    if (cmdBar) cmdBar.style.display = statusClass === 'running' ? 'flex' : 'none';

    let info = null;
    const api = getAPI();
    try { info = await api.GetProcessInfo(p.id); } catch (e) { /* ignore */ }

    const infoGrid = document.getElementById('info-grid');
    infoGrid.innerHTML = `
        <div class="info-item">
            <span class="info-item-label">命令</span>
            <span class="info-item-value mono">${esc(p.command)} ${esc((p.args || []).join(' '))}</span>
        </div>
        <div class="info-item">
            <span class="info-item-label">工作目录</span>
            <span class="info-item-value mono">${esc(p.workDir || '—')}</span>
        </div>
        <div class="info-item">
            <span class="info-item-label">端口</span>
            <span class="info-item-value mono" data-field="port">${p.port || info?.port || '—'}</span>
        </div>
        <div class="info-item">
            <span class="info-item-label">PID</span>
            <span class="info-item-value mono" data-field="pid">${info?.pid || p.pid || '—'}</span>
        </div>
        <div class="info-item">
            <span class="info-item-label">运行时间</span>
            <span class="info-item-value" data-field="uptime">${info?.uptime ? formatUptime(info.uptime) : '—'}</span>
        </div>
        <div class="info-item">
            <span class="info-item-label">内存</span>
            <span class="info-item-value" data-field="memory">${info?.memoryMB ? info.memoryMB.toFixed(1) + ' MB' : '—'}</span>
        </div>
        <div class="info-item">
            <span class="info-item-label">CPU</span>
            <span class="info-item-value" data-field="cpu">${(info?.cpuPercent != null && info.cpuPercent >= 0) ? info.cpuPercent.toFixed(1) + '%' : '—'}</span>
        </div>
        <div class="info-item">
            <span class="info-item-label">重启次数</span>
            <span class="info-item-value" data-field="restart">${info?.restartCount ?? p.restartCount ?? 0}</span>
        </div>
    `;

    await loadLogs();
}

// ========== 进程操作 ==========
export async function startProject(id) {
    const btn = document.getElementById('btn-detail-start');
    setBtnLoading(btn, true);
    setImmediateStatus(id, 'starting');
    const api = getAPI();
    try {
        await api.StartProject(id);
        const p = state.projects.find(x => x.id === id);
        toast(`${p ? p.name : id} 已启动`, 'success');
        setImmediateStatus(id, 'running');
    } catch (e) {
        toast('启动失败: ' + (e.message || e), 'error');
        setImmediateStatus(id, 'stopped');
    }
    setBtnLoading(btn, false);
    await refreshData();
}

export async function stopProject(id) {
    const btn = document.getElementById('btn-detail-stop');
    setBtnLoading(btn, true);
    setImmediateStatus(id, 'stopping');
    const api = getAPI();
    try {
        await api.StopProject(id);
        await refreshData();
        const p = state.projects.find(x => x.id === id);
        const actualStatus = p ? (p.status || 'stopped') : 'stopped';
        if (actualStatus === 'stopped') {
            toast(`${p ? p.name : id} 已停止`, 'info');
        } else {
            toast(`${p ? p.name : id} 正在停止中...`, 'info');
        }
    } catch (e) {
        toast('停止失败: ' + (e.message || e), 'error');
        await refreshData();
    }
    setBtnLoading(btn, false);
}

export async function restartProject(id) {
    const btn = document.getElementById('btn-detail-restart');
    setBtnLoading(btn, true);
    setImmediateStatus(id, 'stopping');
    const api = getAPI();
    try {
        await api.RestartProject(id);
        await refreshData();
        const p = state.projects.find(x => x.id === id);
        const actualStatus = p ? (p.status || 'stopped') : 'stopped';
        if (actualStatus === 'running' || actualStatus === 'starting') {
            toast(`${p ? p.name : id} 已重启`, 'success');
        } else {
            toast(`${p ? p.name : id} 重启中...`, 'info');
        }
    } catch (e) {
        toast('重启失败: ' + (e.message || e), 'error');
    }
    setBtnLoading(btn, false);
}

export async function startGroup(gid) {
    const api = getAPI();
    try {
        const ids = await api.StartGroup(gid);
        toast(`已启动 ${ids.length} 个项目`, 'success');
    } catch (e) { toast('启动分组失败', 'error'); }
    await refreshData();
}

export async function stopGroup(gid) {
    const api = getAPI();
    try {
        const ids = await api.StopGroup(gid);
        toast(`已停止 ${ids.length} 个项目`, 'info');
    } catch (e) { toast('停止分组失败', 'error'); }
    await refreshData();
}

export async function deleteGroup(gid) {
    if (!(await showConfirm('确定删除此分组？组内项目不会被删除。'))) return;
    const api = getAPI();
    try {
        await api.DeleteGroup(gid);
        toast('分组已删除', 'success');
    } catch (e) { toast('删除失败', 'error'); }
    await refreshData();
}

// ========== 模态框 ==========
export function openProjectModal(project = null) {
    state.editingProject = project;
    document.getElementById('modal-project-title').textContent = project ? '编辑项目' : '添加项目';
    document.getElementById('proj-id').value = project?.id || '';
    document.getElementById('proj-id').disabled = !!project;
    document.getElementById('proj-name').value = project?.name || '';
    document.getElementById('proj-type').value = project?.type || 'node';
    document.getElementById('proj-command').value = project?.command || '';
    document.getElementById('proj-args').value = (project?.args || []).join(' ');
    document.getElementById('proj-workdir').value = project?.workDir || '';
    document.getElementById('proj-port').value = project?.port || '';
    document.getElementById('proj-autostart').checked = project?.autoStart || false;
    document.getElementById('proj-autorestart').checked = project?.autorestart ?? true;
    document.getElementById('proj-maxrestart').value = project?.maxRestartCount ?? 5;
    document.getElementById('proj-restartdelay').value = project?.restartDelay ?? 3;

    const select = document.getElementById('proj-group');
    select.innerHTML = '<option value="">无分组</option>';
    for (const g of state.groups) {
        const selected = project?.groupId === g.id ? 'selected' : '';
        select.innerHTML += `<option value="${esc(g.id)}" ${selected}>${esc(g.name)}</option>`;
    }

    openModal('modal-project');
}

// ========== 事件绑定 ==========
export function bindProjectsEvents() {
    // 侧边栏搜索
    document.getElementById('sidebar-search').addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderSidebar();
    });

    // 侧边栏事件委托
    document.getElementById('sidebar-projects').addEventListener('click', (e) => {
        const item = e.target.closest('.project-item');
        if (item && item.dataset.projectId) {
            selectProject(item.dataset.projectId);
            return;
        }
        const header = e.target.closest('.project-group-header');
        if (header && !e.target.closest('.group-actions')) {
            const group = header.closest('.project-group');
            const gid = group?.dataset.group;
            if (gid) {
                state.collapsedGroups[gid] = !state.collapsedGroups[gid];
                renderSidebar();
            }
            return;
        }
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            const gid = actionBtn.dataset.gid;
            if (action === 'start-group' && gid) startGroup(gid);
            if (action === 'stop-group' && gid) stopGroup(gid);
            if (action === 'delete-group' && gid) deleteGroup(gid);
        }
    });

    // 项目网格事件委托（项目管理页 + 仪表盘概览）
    const grid = document.getElementById('project-grid');
    if (grid) {
        grid.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                const id = actionBtn.dataset.id;
                if (action === 'start' && id) startProject(id);
                if (action === 'stop' && id) stopProject(id);
                if (action === 'restart' && id) restartProject(id);
                return;
            }
            const card = e.target.closest('.project-card');
            if (card && card.dataset.cardId) {
                selectProject(card.dataset.cardId);
            }
        });
    }

    // 添加项目/分组
    document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal());
    document.getElementById('btn-add-group').addEventListener('click', () => {
        document.getElementById('group-id').value = '';
        document.getElementById('group-name').value = '';
        openModal('modal-group');
    });

    // 浏览按钮
    document.getElementById('btn-browse-command').addEventListener('click', async () => {
        const api = getAPI();
        try {
            const path = await api.SelectExecutable();
            if (path) document.getElementById('proj-command').value = path;
        } catch (e) { toast('选择文件失败', 'error'); }
    });

    document.getElementById('btn-browse-workdir').addEventListener('click', async () => {
        // Phase 5：切换内嵌文件浏览面板，替代系统对话框
        const panel = document.getElementById('filebrowser-panel');
        if (panel.style.display === 'none') {
            const current = document.getElementById('proj-workdir').value.trim();
            await openFileBrowser(current);
        } else {
            closeFileBrowser();
        }
    });

    // Phase 5：文件浏览面板按钮
    bindFileBrowserEvents();

    // Phase 5：启动顺序按钮
    document.getElementById('btn-autostart-order')?.addEventListener('click', openAutoStartOrderModal);
    document.getElementById('btn-save-autostart-order')?.addEventListener('click', saveAutoStartOrder);

    // 保存项目
    document.getElementById('btn-save-project').addEventListener('click', async () => {
        const input = {
            id: document.getElementById('proj-id').value.trim(),
            name: document.getElementById('proj-name').value.trim(),
            type: document.getElementById('proj-type').value,
            command: document.getElementById('proj-command').value.trim(),
            args: document.getElementById('proj-args').value.trim().split(/\s+/).filter(Boolean),
            workDir: document.getElementById('proj-workdir').value.trim(),
            port: parseInt(document.getElementById('proj-port').value) || 0,
            groupId: document.getElementById('proj-group').value,
            autoStart: document.getElementById('proj-autostart').checked,
            autoRestart: document.getElementById('proj-autorestart').checked,
            maxRestartCount: parseInt(document.getElementById('proj-maxrestart').value) || 0,
            restartDelay: parseInt(document.getElementById('proj-restartdelay').value) || 3,
        };

        if (!input.id || !input.name || !input.command) {
            toast('请填写 ID、名称和启动命令', 'error');
            return;
        }

        const api = getAPI();
        try {
            if (state.editingProject) {
                await api.UpdateProject(input);
                toast('项目已更新', 'success');
            } else {
                await api.AddProject(input);
                toast('项目已添加', 'success');
            }
            closeModal('modal-project');
            await refreshData();
        } catch (e) {
            toast('保存失败: ' + (e.message || e), 'error');
        }
    });

    // 保存分组
    document.getElementById('btn-save-group').addEventListener('click', async () => {
        const input = {
            id: document.getElementById('group-id').value.trim(),
            name: document.getElementById('group-name').value.trim(),
        };
        if (!input.id || !input.name) {
            toast('请填写分组 ID 和名称', 'error');
            return;
        }
        const api = getAPI();
        try {
            await api.AddGroup(input);
            toast('分组已创建', 'success');
            closeModal('modal-group');
            await refreshData();
        } catch (e) {
            toast('创建失败: ' + (e.message || e), 'error');
        }
    });

    // 项目详情操作
    document.getElementById('btn-detail-start').addEventListener('click', () => startProject(state.selectedProjectId));
    document.getElementById('btn-detail-stop').addEventListener('click', () => stopProject(state.selectedProjectId));
    document.getElementById('btn-detail-restart').addEventListener('click', () => restartProject(state.selectedProjectId));

    document.getElementById('btn-detail-edit').addEventListener('click', () => {
        const p = state.projects.find(x => x.id === state.selectedProjectId);
        if (p) openProjectModal(p);
    });

    document.getElementById('btn-detail-delete').addEventListener('click', async () => {
        if (!(await showConfirm('确定删除此项目？'))) return;
        const api = getAPI();
        try {
            await api.DeleteProject(state.selectedProjectId);
            toast('项目已删除', 'success');
            state.selectedProjectId = null;
            showView('dashboard');
            await refreshData();
        } catch (e) { toast('删除失败', 'error'); }
    });

    // 返回按钮
    document.getElementById('btn-back-dashboard').addEventListener('click', () => {
        state.selectedProjectId = null;
        showView('dashboard');
        renderSidebar();
        refreshData();
    });
    document.getElementById('btn-back-from-settings').addEventListener('click', () => {
        showView('dashboard');
        renderSidebar();
        refreshData();
    });

    // 全部启动/停止
    document.getElementById('btn-start-all').addEventListener('click', async () => {
        const api = getAPI();
        for (const p of state.projects) {
            if (p.status !== 'running') {
                try { await api.StartProject(p.id); } catch (e) { /* ignore */ }
            }
        }
        toast('已启动所有项目', 'success');
        await refreshData();
    });

    document.getElementById('btn-stop-all').addEventListener('click', async () => {
        const api = getAPI();
        for (const p of state.projects) {
            if (p.status === 'running') {
                try { await api.StopProject(p.id); } catch (e) { /* ignore */ }
            }
        }
        toast('已停止所有项目', 'info');
        await refreshData();
    });
}

// ========== 数据刷新 ==========
export async function refreshData() {
    try {
        const api = getAPI();
        state.projects = await api.GetProjects() || [];
        state.groups = await api.GetGroups() || [];
        renderSidebar();
        renderProjectGrid();
        if (state.currentView === 'dashboard') {
            // 仪表盘统计卡片需要更新
            const { renderStatCards } = await import('./dashboard.js');
            renderStatCards();
        }
        if (state.currentView === 'project') await renderProjectDetail();
    } catch (e) {
        console.error('刷新数据失败:', e);
    }
}

// 轮询用的轻量刷新（更新项目状态 + 详情视图 + 网格）
export async function refreshProjectsForPoll() {
    try {
        const api = getAPI();
        state.projects = await api.GetProjects() || [];
        renderSidebar();
        renderProjectGrid();
        // 统计卡片同步
        const { renderStatCards } = await import('./dashboard.js');
        renderStatCards();

        if (state.currentView === 'project') {
            const p = state.projects.find(x => x.id === state.selectedProjectId);
            if (p) {
                const statusEl = document.getElementById('detail-status');
                const sc = p.status || 'stopped';
                statusEl.className = 'detail-status-badge ' + sc;
                statusEl.innerHTML = `<span class="status-dot ${sc}"></span><span>${getStatusLabel(sc)}</span>`;

                const btnStart = document.getElementById('btn-detail-start');
                const btnStop = document.getElementById('btn-detail-stop');
                const btnRestart = document.getElementById('btn-detail-restart');
                btnStart.style.display = (sc === 'running' || sc === 'starting') ? 'none' : '';
                btnStop.style.display = (sc === 'running' || sc === 'starting') ? '' : 'none';
                btnRestart.style.display = (sc === 'running' || sc === 'starting') ? '' : 'none';

                [btnStart, btnStop, btnRestart].forEach(btn => {
                    if (btn && btn.classList.contains('btn-loading')) setBtnLoading(btn, false);
                });

                if (sc === 'running' || sc === 'starting') {
                    try {
                        const info = await api.GetProcessInfo(p.id);
                        const infoGrid = document.getElementById('info-grid');
                        if (infoGrid && info) {
                            const set = (field, val) => {
                                const el = infoGrid.querySelector(`[data-field="${field}"]`);
                                if (el) el.textContent = val;
                            };
                            set('port', info.port || p.port || '—');
                            set('pid', info.pid || p.pid || '—');
                            set('uptime', info.uptime ? formatUptime(info.uptime) : '—');
                            set('memory', info.memoryMB ? info.memoryMB.toFixed(1) + ' MB' : '—');
                            set('cpu', (info.cpuPercent != null && info.cpuPercent >= 0) ? info.cpuPercent.toFixed(1) + '%' : '—');
                            set('restart', info.restartCount ?? 0);
                        }
                    } catch (e2) { /* ignore */ }
                }
            }
        }
    } catch (e) { /* ignore */ }
}

// ========== 视图切换（共享，供各模块调用） ==========
export function showView(view) {
    state.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add('active');

    // 顶部导航高亮
    document.querySelectorAll('.topnav-item').forEach(item => item.classList.remove('active'));
    const nav = document.getElementById(`nav-tab-${view}`);
    if (nav) nav.classList.add('active');
}

export function openModal(id) {
    document.getElementById(id).classList.add('active');
}

export function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// ========== Phase 5：内嵌文件浏览面板 ==========

// 文件浏览器状态
const fileBrowser = {
    currentPath: '',   // 当前显示的目录路径，'' 表示根（我的电脑）
    selectedPath: '',  // 当前选中的路径（用于回填）
    history: [],       // 导航历史，用于「上一级」
};

// 打开文件浏览面板，initialPath 为可选初始路径
export async function openFileBrowser(initialPath) {
    const panel = document.getElementById('filebrowser-panel');
    if (!panel) return;
    panel.style.display = 'block';
    fileBrowser.history = [];
    // 如果给了初始路径，尝试直接打开该路径
    if (initialPath) {
        await loadDir(initialPath);
    } else {
        await loadDir('');
    }
}

// 关闭文件浏览面板
export function closeFileBrowser() {
    const panel = document.getElementById('filebrowser-panel');
    if (panel) panel.style.display = 'none';
}

// 加载指定目录内容到右栏；path 为空表示根（驱动器列表）
export async function loadDir(path) {
    const api = getAPI();
    const listEl = document.getElementById('filebrowser-list');
    const breadcrumb = document.getElementById('filebrowser-breadcrumb');

    try {
        listEl.innerHTML = '<div class="filebrowser-loading">加载中...</div>';
        const entries = await api.ListDir(path);
        fileBrowser.currentPath = path || '';
        fileBrowser.selectedPath = path || '';

        // 更新面包屑
        if (!path) {
            breadcrumb.textContent = '我的电脑';
        } else {
            breadcrumb.textContent = path;
        }

        renderFileList(entries);
        renderFileTree();
    } catch (e) {
        listEl.innerHTML = `<div class="filebrowser-error">无法访问: ${esc(e.message || String(e))}</div>`;
        toast('读取目录失败: ' + (e.message || e), 'error');
    }
}

// 渲染右栏文件/目录列表
function renderFileList(entries) {
    const listEl = document.getElementById('filebrowser-list');
    if (!entries || entries.length === 0) {
        listEl.innerHTML = '<div class="filebrowser-empty">空目录</div>';
        return;
    }

    listEl.innerHTML = entries.map(e => {
        const icon = e.isDir
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        const sizeText = e.isDir ? '' : formatFileSize(e.size);
        const selected = e.path === fileBrowser.selectedPath ? ' selected' : '';
        return `<div class="fb-entry${selected}${e.isDir ? ' is-dir' : ''}" data-path="${esc(e.path)}" data-isdir="${e.isDir}">
            <span class="fb-entry-icon">${icon}</span>
            <span class="fb-entry-name">${esc(e.name)}</span>
            <span class="fb-entry-size">${sizeText}</span>
        </div>`;
    }).join('');

    // 绑定点击事件
    listEl.querySelectorAll('.fb-entry').forEach(el => {
        el.addEventListener('click', () => {
            const path = el.dataset.path;
            const isDir = el.dataset.isdir === 'true';
            // 选中高亮
            listEl.querySelectorAll('.fb-entry').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            fileBrowser.selectedPath = path;
        });
        el.addEventListener('dblclick', () => {
            const path = el.dataset.path;
            const isDir = el.dataset.isdir === 'true';
            if (isDir) {
                // 双击目录 → 进入该目录
                if (fileBrowser.currentPath) fileBrowser.history.push(fileBrowser.currentPath);
                loadDir(path);
            }
        });
    });
}

// 渲染左栏目录树（简化的驱动器+快速访问）
async function renderFileTree() {
    const treeEl = document.getElementById('filebrowser-tree');
    const api = getAPI();
    try {
        // 根：显示「我的电脑」+ 驱动器列表
        const drives = await api.ListDir('');
        const driveItems = drives.map(d => {
            const isActive = fileBrowser.currentPath && fileBrowser.currentPath.toUpperCase().startsWith(d.path.toUpperCase().replace('\\', ''));
            return `<div class="fb-tree-item${isActive ? ' active' : ''}" data-path="${esc(d.path)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                <span>${esc(d.name)}</span>
            </div>`;
        }).join('');
        treeEl.innerHTML = `
            <div class="fb-tree-section">
                <div class="fb-tree-item${!fileBrowser.currentPath ? ' active' : ''}" data-path="">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                    <span>我的电脑</span>
                </div>
                ${driveItems}
            </div>
        `;
        // 绑定点击
        treeEl.querySelectorAll('.fb-tree-item').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.path;
                if (fileBrowser.currentPath) fileBrowser.history.push(fileBrowser.currentPath);
                loadDir(path);
            });
        });
    } catch (e) {
        treeEl.innerHTML = '<div class="filebrowser-error">加载驱动器失败</div>';
    }
}

// 上一级
async function navigateUp() {
    if (fileBrowser.history.length > 0) {
        const prev = fileBrowser.history.pop();
        await loadDir(prev);
    } else if (fileBrowser.currentPath) {
        // 取父目录
        const parent = getParentPath(fileBrowser.currentPath);
        await loadDir(parent);
    }
}

// 计算父目录路径（Windows 风格）
function getParentPath(path) {
    if (!path || path.length <= 3) return ''; // 如 C:\ 的父是根
    // 去掉末尾的反斜杠
    let p = path.replace(/\\+$/, '');
    const idx = p.lastIndexOf('\\');
    if (idx <= 2) {
        // 回到驱动器根 C:\
        return p.substring(0, 3);
    }
    return p.substring(0, idx);
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// 绑定文件浏览面板按钮事件
function bindFileBrowserEvents() {
    document.getElementById('btn-filebrowser-up')?.addEventListener('click', navigateUp);
    document.getElementById('btn-filebrowser-refresh')?.addEventListener('click', () => loadDir(fileBrowser.currentPath));
    document.getElementById('btn-filebrowser-close')?.addEventListener('click', closeFileBrowser);
    document.getElementById('btn-filebrowser-confirm')?.addEventListener('click', () => {
        if (fileBrowser.selectedPath) {
            document.getElementById('proj-workdir').value = fileBrowser.selectedPath;
            closeFileBrowser();
            toast('已选择工作目录', 'success');
        } else {
            toast('请先选择一个目录', 'error');
        }
    });
}

// ========== Phase 5：启动项拖拽排序 ==========

// 启动项排序状态
let autostartOrderState = [];

// 打开启动项排序模态框
export async function openAutoStartOrderModal() {
    const api = getAPI();
    try {
        const allProjects = await api.GetProjects() || [];
        // 筛选自启项目，按 sortOrder 升序
        autostartOrderState = allProjects
            .filter(p => p.autoStart)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
            .map(p => ({ id: p.id, name: p.name, type: p.type, status: p.status }));

        const listEl = document.getElementById('autostart-order-list');
        const emptyEl = document.getElementById('autostart-order-empty');
        if (autostartOrderState.length === 0) {
            listEl.style.display = 'none';
            emptyEl.style.display = 'block';
        } else {
            listEl.style.display = 'block';
            emptyEl.style.display = 'none';
            renderAutoStartOrderList();
        }
        openModal('modal-autostart-order');
    } catch (e) {
        toast('加载自启项目失败: ' + (e.message || e), 'error');
    }
}

// 渲染排序列表（含拖拽）
function renderAutoStartOrderList() {
    const listEl = document.getElementById('autostart-order-list');
    listEl.innerHTML = autostartOrderState.map((p, i) => {
        const typeInfo = getTypeInfoSafe(p.type);
        return `<div class="autostart-item" draggable="true" data-index="${i}">
            <div class="autostart-item-drag" title="拖拽排序">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            </div>
            <span class="autostart-item-order">${i + 1}</span>
            <span class="autostart-item-badge ${typeInfo.cls}">${typeInfo.label}</span>
            <span class="autostart-item-name">${esc(p.name)}</span>
            <span class="autostart-item-status status-${p.status}">${getStatusLabel(p.status)}</span>
        </div>`;
    }).join('');

    bindDragEvents();
}

// 安全获取类型信息
function getTypeInfoSafe(type) {
    const map = {
        go: { label: 'Go', cls: 'type-go' },
        node: { label: 'Node', cls: 'type-nodejs' },
        python: { label: 'Python', cls: 'type-python' },
        custom: { label: '自定义', cls: 'type-custom' },
    };
    return map[type] || map.custom;
}

// 绑定 HTML5 拖拽事件
function bindDragEvents() {
    const listEl = document.getElementById('autostart-order-list');
    let dragSrcIdx = null;

    listEl.querySelectorAll('.autostart-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragSrcIdx = parseInt(item.dataset.index);
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(dragSrcIdx));
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            listEl.querySelectorAll('.autostart-item').forEach(x => {
                x.classList.remove('drag-over-top', 'drag-over-bottom');
            });
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (item.classList.contains('dragging')) return;
            const rect = item.getBoundingClientRect();
            const isAbove = e.clientY < rect.top + rect.height / 2;
            item.classList.toggle('drag-over-top', isAbove);
            item.classList.toggle('drag-over-bottom', !isAbove);
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const destIdx = parseInt(item.dataset.index);
            if (dragSrcIdx === null || dragSrcIdx === destIdx) return;

            const rect = item.getBoundingClientRect();
            const isAbove = e.clientY < rect.top + rect.height / 2;
            let insertIdx = isAbove ? destIdx : destIdx + 1;

            // 移动元素
            const [moved] = autostartOrderState.splice(dragSrcIdx, 1);
            // 调整插入索引（如果源在目标之前，splice 后索引下移）
            if (dragSrcIdx < insertIdx) insertIdx--;
            autostartOrderState.splice(insertIdx, 0, moved);

            renderAutoStartOrderList();
            dragSrcIdx = null;
        });
    });
}

// 保存启动顺序
export async function saveAutoStartOrder() {
    const api = getAPI();
    const orderedIDs = autostartOrderState.map(p => p.id);
    try {
        setBtnLoading('btn-save-autostart-order', true);
        await api.ReorderAutoStartProjects(orderedIDs);
        toast('启动顺序已保存', 'success');
        closeModal('modal-autostart-order');
        await refreshData();
    } catch (e) {
        toast('保存失败: ' + (e.message || e), 'error');
    } finally {
        setBtnLoading('btn-save-autostart-order', false);
    }
}
