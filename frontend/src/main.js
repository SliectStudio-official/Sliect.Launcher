import './style.css';
import './app.css';

// ========== API 抽象层 ==========
// 在 Wails 环境中使用真实绑定，开发模式下使用模拟
let api = null;
let wailsRuntime = null;

async function initAPI() {
    try {
        const app = await import('../wailsjs/go/main/App.js');
        const rt = await import('../wailsjs/runtime/runtime.js');
        api = {
            GetProjects: () => app.GetProjects(),
            GetProject: (id) => app.GetProject(id),
            AddProject: (input) => app.AddProject(input),
            UpdateProject: (input) => app.UpdateProject(input),
            DeleteProject: (id) => app.DeleteProject(id),
            StartProject: (id) => app.StartProject(id),
            StopProject: (id) => app.StopProject(id),
            ForceStopProject: (id) => app.ForceStopProject(id),
            RestartProject: (id) => app.RestartProject(id),
            SendCommand: (pid, cmd) => app.SendCommand(pid, cmd),
            GetGroups: () => app.GetGroups(),
            AddGroup: (input) => app.AddGroup(input),
            UpdateGroup: (input) => app.UpdateGroup(input),
            DeleteGroup: (id) => app.DeleteGroup(id),
            StartGroup: (gid) => app.StartGroup(gid),
            StopGroup: (gid) => app.StopGroup(gid),
            GetLogs: (pid, n) => app.GetLogs(pid, n),
            ClearLogs: (pid) => app.ClearLogs(pid),
            GetProcessInfo: (pid) => app.GetProcessInfo(pid),
            GetAllProcessInfo: () => app.GetAllProcessInfo(),
            GetGlobalSettings: () => app.GetGlobalSettings(),
            UpdateGlobalSettings: (t, m, s, a, r) => app.UpdateGlobalSettings(t, m, s, a, r),
            SelectExecutable: () => app.SelectExecutable(),
            SelectFolder: (title) => app.SelectFolder(title),
            SelectFile: (title, filters) => app.SelectFile(title, filters),
            GetSystemStats: () => app.GetSystemStats(),
            GetTopProcesses: () => app.GetTopProcesses(),
            GetLogStats: () => app.GetLogStats(),
            GetDebugInfo: (pid) => app.GetDebugInfo(pid),
            OpenURL: (url) => app.OpenURL(url),
            CheckPortInUse: (port) => app.CheckPortInUse(port),
            KillProcessByPID: (pid) => app.KillProcessByPID(pid),
            WindowMinimise: () => app.WindowMinimise(),
            WindowMaximise: () => app.WindowMaximise(),
            WindowUnmaximise: () => app.WindowUnmaximise(),
            WindowClose: () => app.WindowClose(),
            StartWindowDrag: () => app.StartWindowDrag(),
            WindowSetPosition: (x, y) => app.WindowSetPosition(x, y),
            WindowGetPosition: () => app.WindowGetPosition(),
            SendCommand: (projectId, cmd) => app.SendCommand(projectId, cmd),
        };
        wailsRuntime = rt;
        console.log('[API] Wails 绑定已加载');
    } catch (e) {
        console.log('[API] 开发模式：使用模拟数据');
        api = createMockAPI();
    }
}

// 模拟 API（开发模式）
function createMockAPI() {
    let projects = [
        { id: 'su-backend', name: '速办通后端', groupId: 'su', type: 'go', command: 'go run cmd/server/main.go', args: [], workDir: 'E:\\su.sliect.cn\\server', port: 8080, env: {}, autoStart: true, autoRestart: true, maxRestartCount: 5, restartDelay: 3, sortOrder: 0, status: 'running', pid: 12345, restartCount: 0 },
        { id: 'su-frontend', name: '速办通前端', groupId: 'su', type: 'node', command: 'npm run dev', args: [], workDir: 'E:\\su.sliect.cn', port: 3000, env: {}, autoStart: false, autoRestart: false, maxRestartCount: 0, restartDelay: 3, sortOrder: 1, status: 'stopped', pid: 0, restartCount: 0 },
        { id: 'my-bot', name: 'QQ 机器人', groupId: '', type: 'python', command: 'python main.py', args: [], workDir: 'E:\\projects\\qq-bot', port: 5000, env: {}, autoStart: false, autoRestart: true, maxRestartCount: 10, restartDelay: 5, sortOrder: 2, status: 'crashed', pid: 0, restartCount: 3 },
        { id: 'nginx-proxy', name: 'Nginx 代理', groupId: 'infra', type: 'custom', command: 'nginx', args: ['-g', 'daemon off;'], workDir: 'C:\\nginx', port: 80, env: {}, autoStart: true, autoRestart: true, maxRestartCount: 5, restartDelay: 3, sortOrder: 3, status: 'running', pid: 2048, restartCount: 0 },
        { id: 'api-gateway', name: 'API 网关', groupId: 'infra', type: 'go', command: 'go run main.go', args: ['--port', '8080'], workDir: 'E:\\Projects\\api-gateway', port: 8081, env: {}, autoStart: true, autoRestart: true, maxRestartCount: 5, restartDelay: 3, sortOrder: 4, status: 'running', pid: 13201, restartCount: 0 },
    ];
    let groups = [
        { id: 'su', name: '速办通', sortOrder: 0 },
        { id: 'infra', name: '基础设施', sortOrder: 1 },
    ];
    let settings = { version: 1, theme: 'light', minimizeToTray: true, startOnBoot: false, autoRestartGlobal: false, globalMaxRestartCount: 5, groups, projects };
    let logs = {};

    return {
        GetProjects: async () => [...projects],
        GetProject: async (id) => projects.find(p => p.id === id) || null,
        AddProject: async (input) => { projects.push({ ...input, status: 'stopped', pid: 0, restartCount: 0 }); },
        UpdateProject: async (input) => { const i = projects.findIndex(p => p.id === input.id); if (i >= 0) projects[i] = { ...projects[i], ...input }; },
        DeleteProject: async (id) => { projects = projects.filter(p => p.id !== id); },
        StartProject: async (id) => { const p = projects.find(x => x.id === id); if (p) { p.status = 'running'; p.pid = Math.floor(Math.random() * 90000) + 10000; } },
        StopProject: async (id) => { const p = projects.find(x => x.id === id); if (p) { p.status = 'stopped'; p.pid = 0; } },
        ForceStopProject: async (id) => { const p = projects.find(x => x.id === id); if (p) { p.status = 'stopped'; p.pid = 0; } },
        RestartProject: async (id) => { const p = projects.find(x => x.id === id); if (p) { p.status = 'running'; p.pid = Math.floor(Math.random() * 90000) + 10000; } },
        GetGroups: async () => [...groups],
        AddGroup: async (input) => { groups.push(input); },
        UpdateGroup: async (input) => { const i = groups.findIndex(g => g.id === input.id); if (i >= 0) groups[i] = input; },
        DeleteGroup: async (id) => { groups = groups.filter(g => g.id !== id); projects.forEach(p => { if (p.groupId === id) p.groupId = ''; }); },
        StartGroup: async (gid) => projects.filter(p => p.groupId === gid).map(p => { p.status = 'running'; p.pid = Math.floor(Math.random() * 90000) + 10000; return p.id; }),
        StopGroup: async (gid) => projects.filter(p => p.groupId === gid).map(p => { p.status = 'stopped'; p.pid = 0; return p.id; }),
        GetLogs: async (pid) => {
            if (!logs[pid]) {
                logs[pid] = [
                    { timestamp: new Date(Date.now() - 60000).toISOString(), level: 'info', source: 'system', text: `${pid} 进程已启动` },
                    { timestamp: new Date(Date.now() - 55000).toISOString(), level: 'info', source: 'stdout', text: 'Loading configuration...' },
                    { timestamp: new Date(Date.now() - 50000).toISOString(), level: 'info', source: 'stdout', text: 'Server started on port 8080' },
                    { timestamp: new Date(Date.now() - 30000).toISOString(), level: 'warn', source: 'stdout', text: 'High memory usage detected' },
                    { timestamp: new Date(Date.now() - 10000).toISOString(), level: 'debug', source: 'stdout', text: 'Processing request batch #142' },
                ];
            }
            return (logs[pid] || []).slice(-200);
        },
        ClearLogs: async (pid) => { logs[pid] = []; },
        GetProcessInfo: async (pid) => {
            const p = projects.find(x => x.id === pid);
            return p ? {
                projectId: pid, status: p.status, pid: p.pid,
                uptime: p.status === 'running' ? Math.floor(Math.random() * 3600) : 0,
                memoryMB: p.status === 'running' ? +(Math.random() * 200).toFixed(1) : 0,
                cpuPercent: p.status === 'running' ? +(Math.random() * 15).toFixed(1) : 0,
                restartCount: p.restartCount || 0
            } : { projectId: pid, status: 'stopped', pid: 0, uptime: 0, memoryMB: 0, cpuPercent: 0, restartCount: 0 };
        },
        GetAllProcessInfo: async () => projects.map(p => ({
            projectId: p.id, status: p.status, pid: p.pid,
            uptime: p.status === 'running' ? Math.floor(Math.random() * 3600) : 0,
            memoryMB: p.status === 'running' ? +(Math.random() * 200).toFixed(1) : 0,
            cpuPercent: p.status === 'running' ? +(Math.random() * 15).toFixed(1) : 0,
            restartCount: p.restartCount || 0
        })),
        GetGlobalSettings: async () => ({ ...settings }),
        UpdateGlobalSettings: async (t, m, s, a, r) => { settings.theme = t || settings.theme; settings.minimizeToTray = m; settings.startOnBoot = s; settings.autoRestartGlobal = a; settings.globalMaxRestartCount = r; },
        SelectExecutable: async () => prompt('输入可执行文件路径（开发模式模拟）:', 'C:\\'),
        SelectFolder: async (title) => prompt(title || '输入文件夹路径（开发模式模拟）:', 'C:\\'),
        SelectFile: async (title) => prompt(title || '输入文件路径（开发模式模拟）:', 'C:\\'),
        OpenURL: async (url) => { window.open(url, '_blank'); },
        CheckPortInUse: async (port) => null,
        KillProcessByPID: async (pid) => { console.log('Mock kill PID:', pid); },
        GetSystemStats: async () => ({ cpuPercent: +(Math.random() * 60 + 10).toFixed(1), cpuCores: 16, memTotal: 34359738368, memUsed: 20615843021, memPercent: 60.0, swapTotal: 8589934592, swapUsed: 2147483648, swapPercent: 25.0 }),
        GetTopProcesses: async () => ({
            byCpu: [{ pid: 1234, name: 'chrome.exe', cpuPercent: 28.5, memMB: 1200, memPercent: 3.5 }, { pid: 5678, name: 'node.exe', cpuPercent: 15.2, memMB: 450, memPercent: 1.3 }, { pid: 9012, name: 'Code.exe', cpuPercent: 8.7, memMB: 800, memPercent: 2.3 }, { pid: 3456, name: 'python.exe', cpuPercent: 5.1, memMB: 200, memPercent: 0.6 }, { pid: 7890, name: 'go.exe', cpuPercent: 2.3, memMB: 50, memPercent: 0.1 }],
            byMem: [{ pid: 1234, name: 'chrome.exe', cpuPercent: 28.5, memMB: 1200, memPercent: 3.5 }, { pid: 9012, name: 'Code.exe', cpuPercent: 8.7, memMB: 800, memPercent: 2.3 }, { pid: 5678, name: 'node.exe', cpuPercent: 15.2, memMB: 450, memPercent: 1.3 }, { pid: 3456, name: 'python.exe', cpuPercent: 5.1, memMB: 200, memPercent: 0.6 }, { pid: 7890, name: 'go.exe', cpuPercent: 2.3, memMB: 50, memPercent: 0.1 }]
        }),
        GetLogStats: async () => ({ error: 3, warn: 12, info: 156, debug: 42, trace: 0 }),
        GetDebugInfo: async (pid) => ({ projectId: pid, inMap: false, bufferCount: 0 }),
        WindowMinimise: async () => { console.log('Mock: minimise'); },
        WindowMaximise: async () => { console.log('Mock: maximise'); },
        WindowUnmaximise: async () => { console.log('Mock: unmaximise'); },
        WindowClose: async () => { console.log('Mock: close'); },
        StartWindowDrag: async () => { console.log('Mock: start window drag'); },
        WindowSetPosition: async (x, y) => { console.log('Mock: set position', x, y); },
        WindowGetPosition: async () => ({ X: 100, Y: 100 }),
        SendCommand: async (projectId, cmd) => { console.log('Mock: send command to', projectId, ':', cmd); return null; },
    };
}

// ========== 应用状态 ==========
const state = {
    projects: [],
    groups: [],
    currentView: 'dashboard',
    selectedProjectId: null,
    editingProject: null,
    logFilter: '',
    logLevelFilter: '',
    searchQuery: '',
    collapsedGroups: {},
};

// ========== 工具函数 ==========
function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '—';
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h >= 24) {
        const d = Math.floor(h / 24);
        return `${d}天${h % 24}时`;
    }
    return `${h}时${m}分`;
}

// 主题应用：将 'auto' 解析为实际的 light/dark
function applyTheme(theme) {
    const resolved = theme === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    return resolved;
}

// 获取当前保存的主题（可能是 auto）
let currentSavedTheme = 'light';

// 监听系统主题变化，当主题为 auto 时自动切换
if (window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', () => {
        if (currentSavedTheme === 'auto') {
            document.body.classList.add('theme-transitioning');
            applyTheme('auto');
            setTimeout(() => document.body.classList.remove('theme-transitioning'), 350);
        }
    });
}

// 将文本中的 URL 转换为可点击链接（先 HTML 转义，再替换 URL）
function linkifyText(text) {
    const escaped = esc(text);
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    return escaped.replace(urlRegex, (url) => {
        return `<a href="#" data-url="${url}" class="log-link">${url}</a>`;
    });
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return val.toFixed(1) + ' ' + units[i];
}

function getTypeInfo(type) {
    const map = {
        go: { label: 'Go', cls: 'type-go' },
        node: { label: 'Node.js', cls: 'type-node' },
        nodejs: { label: 'Node.js', cls: 'type-nodejs' },
        python: { label: 'Python', cls: 'type-python' },
        custom: { label: 'Custom', cls: 'type-custom' },
    };
    return map[type] || { label: type || '', cls: 'type-custom' };
}

function getStatusLabel(status) {
    return { running: '运行中', stopped: '已停止', crashed: '异常', starting: '启动中', stopping: '停止中' }[status] || status || '未知';
}

// ========== Toast 通知 ==========
function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${esc(message)}</span>
        <button class="toast-close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;
    el.querySelector('.toast-close').onclick = () => {
        el.classList.add('removing');
        setTimeout(() => el.remove(), 200);
    };
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('removing');
        setTimeout(() => el.remove(), 200);
    }, 3500);
}

// ========== 自定义弹窗 ==========
const dialogIcons = {
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

function showDialog({ title = '提示', message = '', type = 'info', confirmText = '确定', cancelText = '取消', danger = false }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modal-dialog');
        const iconEl = document.getElementById('dialog-icon');
        const titleEl = document.getElementById('dialog-title');
        const messageEl = document.getElementById('dialog-message');
        const okBtn = document.getElementById('dialog-ok');
        const cancelBtn = document.getElementById('dialog-cancel');

        titleEl.textContent = title;
        messageEl.innerHTML = message;
        iconEl.className = `dialog-icon ${type}`;
        iconEl.innerHTML = dialogIcons[type] || dialogIcons.info;
        okBtn.textContent = confirmText;
        if (danger) okBtn.classList.add('btn-danger'); else okBtn.classList.remove('btn-danger');

        if (cancelText) {
            cancelBtn.textContent = cancelText;
            cancelBtn.style.display = '';
        } else {
            cancelBtn.style.display = 'none';
        }

        overlay.classList.remove('closing');
        overlay.classList.add('active');

        const close = (result) => {
            overlay.classList.remove('active');
            overlay.classList.add('closing');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            setTimeout(() => {
                overlay.classList.remove('closing');
            }, 200);
            resolve(result);
        };

        okBtn.onclick = () => close(true);
        cancelBtn.onclick = () => close(false);
    });
}

function showConfirm(message, title = '确认', type = 'warning') {
    return showDialog({ title, message, type, confirmText: '确定', cancelText: '取消' });
}

// ========== 视图切换 ==========
function showView(view) {
    state.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add('active');

    // Update sidebar nav active state
    document.querySelectorAll('.sidebar-nav-item').forEach(item => item.classList.remove('active'));
    if (view === 'settings') {
        const nav = document.getElementById('nav-settings');
        if (nav) nav.classList.add('active');
    }
}

// ========== 侧边栏渲染 ==========
function renderSidebar() {
    const container = document.getElementById('sidebar-projects');
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

    // Render groups
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

    // Ungrouped
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

// ========== 仪表盘渲染 ==========
function renderDashboard() {
    renderStatCards();
    updateSystemMonitor();
    updateTopProcesses();
    updateLogStats();
    renderProjectGrid();
}

function renderStatCards() {
    const total = state.projects.length;
    const running = state.projects.filter(p => p.status === 'running').length;
    const stopped = state.projects.filter(p => p.status === 'stopped' || !p.status).length;
    const crashed = state.projects.filter(p => p.status === 'crashed').length;

    const container = document.getElementById('stat-cards');
    container.innerHTML = `
        <div class="stat-card">
            <div class="stat-card-icon total">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
            <span class="stat-card-label">全部项目</span>
            <span class="stat-card-value">${total}</span>
            <span class="stat-card-delta positive">已配置</span>
        </div>
        <div class="stat-card">
            <div class="stat-card-icon running">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
            <span class="stat-card-label">运行中</span>
            <span class="stat-card-value">${running}</span>
            <span class="stat-card-delta positive">正常</span>
        </div>
        <div class="stat-card">
            <div class="stat-card-icon stopped">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            </div>
            <span class="stat-card-label">已停止</span>
            <span class="stat-card-value">${stopped}</span>
            <span class="stat-card-delta">${stopped > 0 ? '待处理' : '—'}</span>
        </div>
        <div class="stat-card">
            <div class="stat-card-icon crashed">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <span class="stat-card-label">已崩溃</span>
            <span class="stat-card-value">${crashed}</span>
            <span class="stat-card-delta negative">${crashed > 0 ? '需关注' : '—'}</span>
        </div>
    `;
}

async function updateSystemMonitor() {
    try {
        const s = await api.GetSystemStats();
        const cpuPct = s.cpuPercent?.toFixed(1) || 0;
        const memPct = s.memPercent?.toFixed(1) || 0;
        const circumference = 238.76;

        const cpuRing = document.getElementById('cpu-ring');
        const memRing = document.getElementById('mem-ring');
        cpuRing.style.strokeDashoffset = circumference * (1 - cpuPct / 100);
        memRing.style.strokeDashoffset = circumference * (1 - memPct / 100);

        document.getElementById('cpu-value').textContent = cpuPct + '%';
        document.getElementById('mem-value').textContent = memPct + '%';
        document.getElementById('cpu-cores-label').textContent = `${s.cpuCores} 核处理器`;
        document.getElementById('mem-detail-label').textContent = `${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal)}`;
    } catch (e) { /* ignore */ }
}

async function updateTopProcesses() {
    try {
        const tp = await api.GetTopProcesses();
        const cpuList = document.getElementById('top-cpu-list');
        const memList = document.getElementById('top-mem-list');

        const maxCpu = Math.max(...(tp.byCpu || []).map(p => p.cpuPercent), 1);
        const maxMem = Math.max(...(tp.byMem || []).map(p => p.memMB), 1);

        cpuList.innerHTML = (tp.byCpu || []).map((p, i) => `
            <div class="process-row">
                <span class="process-rank">${i + 1}</span>
                <span class="process-name">${esc(p.name)}</span>
                <div class="process-bar-wrap">
                    <div class="process-bar cpu" style="width: ${(p.cpuPercent / maxCpu * 100).toFixed(0)}%"></div>
                </div>
                <span class="process-value">${p.cpuPercent?.toFixed(1)}%</span>
            </div>
        `).join('') || '<div style="color:var(--fg-weak);padding:8px;font-size:12px">无数据</div>';

        memList.innerHTML = (tp.byMem || []).map((p, i) => `
            <div class="process-row">
                <span class="process-rank">${i + 1}</span>
                <span class="process-name">${esc(p.name)}</span>
                <div class="process-bar-wrap">
                    <div class="process-bar memory" style="width: ${(p.memMB / maxMem * 100).toFixed(0)}%"></div>
                </div>
                <span class="process-value">${p.memMB >= 1024 ? (p.memMB / 1024).toFixed(1) + ' GB' : p.memMB?.toFixed(0) + ' MB'}</span>
            </div>
        `).join('') || '<div style="color:var(--fg-weak);padding:8px;font-size:12px">无数据</div>';
    } catch (e) { /* ignore */ }
}

async function updateLogStats() {
    try {
        const s = await api.GetLogStats();
        document.getElementById('log-stats-chips').innerHTML = `
            <span class="log-chip error"><span class="log-chip-count">${s.error || 0}</span> ERROR</span>
            <span class="log-chip warn"><span class="log-chip-count">${s.warn || 0}</span> WARN</span>
            <span class="log-chip info"><span class="log-chip-count">${s.info || 0}</span> INFO</span>
            <span class="log-chip debug"><span class="log-chip-count">${s.debug || 0}</span> DEBUG</span>
        `;
    } catch (e) { /* ignore */ }
}

function renderProjectGrid() {
    const grid = document.getElementById('project-grid');
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

// ========== 项目详情渲染 ==========
async function renderProjectDetail() {
    const p = state.projects.find(x => x.id === state.selectedProjectId);
    if (!p) { showView('dashboard'); return; }

    document.getElementById('detail-name').textContent = p.name;

    const statusBadge = document.getElementById('detail-status');
    const statusClass = p.status || 'stopped';
    statusBadge.className = 'detail-status-badge ' + statusClass;
    statusBadge.innerHTML = `<span class="status-dot ${statusClass}"></span><span>${getStatusLabel(statusClass)}</span>`;

    // 更新按钮可见性
    document.getElementById('btn-detail-start').style.display = statusClass === 'running' ? 'none' : '';
    document.getElementById('btn-detail-stop').style.display = statusClass === 'running' ? '' : 'none';
    document.getElementById('btn-detail-restart').style.display = statusClass === 'running' ? '' : 'none';

    // 命令输入栏：仅运行中项目显示
    const cmdBar = document.getElementById('log-command-bar');
    if (cmdBar) cmdBar.style.display = statusClass === 'running' ? 'flex' : 'none';

    // 获取进程信息
    let info = null;
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

    // 加载日志
    await loadLogs();
}

// ========== 日志 ==========
async function loadLogs() {
    if (!state.selectedProjectId) return;
    try {
        const logs = await api.GetLogs(state.selectedProjectId, 200);
        const content = document.getElementById('log-content');
        if (!logs || logs.length === 0) {
            content.innerHTML = '<div class="empty-state" style="padding:32px"><p class="text-muted">暂无日志</p></div>';
            return;
        }

        const srcFilter = state.logFilter;
        const lvlFilter = state.logLevelFilter || '';
        const filtered = logs.filter(l => {
            if (srcFilter && l.source !== srcFilter) return false;
            if (lvlFilter && l.level !== lvlFilter) return false;
            return true;
        });

        if (filtered.length === 0) {
            content.innerHTML = '<div class="empty-state" style="padding:32px"><p class="text-muted">无匹配的日志</p></div>';
            return;
        }

        content.innerHTML = filtered.map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
            const lvl = entry.level || 'info';
            return `<div class="log-entry">
                <span class="log-time">${time}</span>
                <span class="log-level ${esc(lvl)}">${esc(lvl.toUpperCase())}</span>
                <span class="log-source">${esc(entry.source)}</span>
                <span class="log-message">${linkifyText(entry.text)}</span>
            </div>`;
        }).join('');
        content.scrollTop = content.scrollHeight;
    } catch (e) {
        console.error('加载日志失败:', e);
    }
}

// ========== 设置渲染 ==========

// 即时保存设置（不弹 toast，静默保存）
async function saveSettingsNow(themeOverride) {
    const theme = themeOverride || currentSavedTheme || 'light';
    const minimize = document.getElementById('setting-minimize-tray')?.checked ?? true;
    const startBoot = document.getElementById('setting-start-boot')?.checked ?? false;
    const autoRestart = document.getElementById('setting-auto-restart')?.checked ?? false;
    const maxRestart = parseInt(document.getElementById('setting-max-restart')?.value, 10) || 5;
    try {
        await api.UpdateGlobalSettings(theme, minimize, startBoot, autoRestart, maxRestart);
    } catch (e) { /* ignore */ }
}

async function renderSettings() {
    try {
        const s = await api.GetGlobalSettings();
        const theme = s.theme || 'light';
        currentSavedTheme = theme;
        applyTheme(theme);
        document.querySelectorAll('.theme-option').forEach(opt => {
            opt.classList.toggle('active', opt.id === 'theme-' + theme);
        });
        document.getElementById('setting-minimize-tray').checked = s.minimizeToTray;
        document.getElementById('setting-start-boot').checked = s.startOnBoot;
        document.getElementById('setting-auto-restart').checked = s.autoRestartGlobal;
        document.getElementById('setting-max-restart').value = s.globalMaxRestartCount || 5;
    } catch (e) {
        console.error('加载设置失败:', e);
    }
}

// ========== 数据刷新 ==========
async function refreshData() {
    try {
        state.projects = await api.GetProjects() || [];
        state.groups = await api.GetGroups() || [];
        renderSidebar();
        if (state.currentView === 'dashboard') renderDashboard();
        if (state.currentView === 'project') await renderProjectDetail();
    } catch (e) {
        console.error('刷新数据失败:', e);
    }
}

// ========== 项目操作 ==========
async function selectProject(id) {
    state.selectedProjectId = id;
    showView('project');
    renderSidebar();
    await renderProjectDetail();
}

// ========== 按钮加载态 & 即时状态反馈 ==========
function setBtnLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.classList.add('btn-loading');
        btn.dataset.origHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> 处理中…';
    } else {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    }
}

function setImmediateStatus(id, status) {
    const label = { starting: '启动中', stopping: '停止中', running: '运行中', stopped: '已停止', crashed: '异常' }[status] || status;
    // 侧边栏圆点
    document.querySelectorAll('[data-project-id]').forEach(el => {
        if (el.dataset.projectId === id) {
            const dot = el.querySelector('.status-dot');
            if (dot) dot.className = 'status-dot ' + status;
        }
    });
    // 详情页徽章
    const badge = document.getElementById('detail-status');
    if (badge && state.selectedProjectId === id) {
        badge.className = 'detail-status-badge ' + status;
        badge.innerHTML = `<span class="status-dot ${status}"></span><span>${label}</span>`;
    }
    // 仪表盘卡片
    document.querySelectorAll('.project-card').forEach(card => {
        if (card.dataset.cardId === id) {
            const dot = card.querySelector('.status-dot');
            if (dot) dot.className = 'status-dot project-card-status ' + status;
        }
    });
}

async function startProject(id) {
    const btn = document.getElementById('btn-detail-start');
    setBtnLoading(btn, true);
    setImmediateStatus(id, 'starting');
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

async function stopProject(id) {
    const btn = document.getElementById('btn-detail-stop');
    setBtnLoading(btn, true);
    setImmediateStatus(id, 'stopping');
    try {
        await api.StopProject(id);
        // 刷新数据，获取后端实际状态
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

async function restartProject(id) {
    const btn = document.getElementById('btn-detail-restart');
    setBtnLoading(btn, true);
    setImmediateStatus(id, 'stopping');
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

async function startGroup(gid) {
    try {
        const ids = await api.StartGroup(gid);
        toast(`已启动 ${ids.length} 个项目`, 'success');
    } catch (e) { toast('启动分组失败', 'error'); }
    await refreshData();
}

async function stopGroup(gid) {
    try {
        const ids = await api.StopGroup(gid);
        toast(`已停止 ${ids.length} 个项目`, 'info');
    } catch (e) { toast('停止分组失败', 'error'); }
    await refreshData();
}

async function deleteGroup(gid) {
    if (!(await showConfirm('确定删除此分组？组内项目不会被删除。'))) return;
    try {
        await api.DeleteGroup(gid);
        toast('分组已删除', 'success');
    } catch (e) { toast('删除失败', 'error'); }
    await refreshData();
}

// ========== 模态框 ==========
function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function openProjectModal(project = null) {
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
    document.getElementById('proj-autorestart').checked = project?.autoRestart ?? true;
    document.getElementById('proj-maxrestart').value = project?.maxRestartCount ?? 5;
    document.getElementById('proj-restartdelay').value = project?.restartDelay ?? 3;

    // 填充分组下拉
    const select = document.getElementById('proj-group');
    select.innerHTML = '<option value="">无分组</option>';
    for (const g of state.groups) {
        const selected = project?.groupId === g.id ? 'selected' : '';
        select.innerHTML += `<option value="${esc(g.id)}" ${selected}>${esc(g.name)}</option>`;
    }

    openModal('modal-project');
}

// ========== 事件绑定 ==========
function bindEvents() {
    // 搜索
    document.getElementById('sidebar-search').addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderSidebar();
    });

    // 侧边栏事件委托
    document.getElementById('sidebar-projects').addEventListener('click', (e) => {
        // 项目点击
        const item = e.target.closest('.project-item');
        if (item && item.dataset.projectId) {
            selectProject(item.dataset.projectId);
            return;
        }
        // 分组折叠
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
        // 分组操作按钮
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

    // 仪表盘事件委托（项目卡片）
    document.getElementById('project-grid').addEventListener('click', (e) => {
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

    // 导航
    document.getElementById('nav-settings').addEventListener('click', () => {
        showView('settings');
        renderSettings();
    });

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

    // ═══════════ 端口检测 ═══════════
    document.getElementById('port-check-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-check-port').click();
    });
    document.getElementById('btn-check-port').addEventListener('click', async () => {
        const input = document.getElementById('port-check-input');
        const result = document.getElementById('port-check-result');
        const port = parseInt(input.value);
        if (!port || port < 1 || port > 65535) {
            toast('请输入 1-65535 之间的端口号', 'error');
            return;
        }
        const btn = document.getElementById('btn-check-port');
        btn.disabled = true;
        btn.textContent = '检测中...';
        try {
            const info = await api.CheckPortInUse(port);
            result.style.display = 'block';
            if (!info) {
                result.innerHTML = `<div class="port-result-row"><span class="port-free">端口 ${port} 当前空闲，无进程占用</span></div>`;
            } else {
                result.innerHTML = `
                    <div class="port-result-row">
                        <div class="port-info">
                            <div class="port-info-item">
                                <span class="port-info-label">端口</span>
                                <span class="port-info-value port-occupied">${port}</span>
                            </div>
                            <div class="port-info-item">
                                <span class="port-info-label">进程</span>
                                <span class="port-info-value">${esc(info.processName)}</span>
                            </div>
                            <div class="port-info-item">
                                <span class="port-info-label">PID</span>
                                <span class="port-info-value">${info.pid}</span>
                            </div>
                        </div>
                        <button class="btn btn-sm btn-danger" id="btn-kill-port-pid" data-pid="${info.pid}">结束进程</button>
                    </div>`;
                document.getElementById('btn-kill-port-pid').addEventListener('click', async (e) => {
                    const pid = parseInt(e.target.dataset.pid);
                    const confirmed = await showConfirm(`确定要终止 PID ${pid} 的进程吗？`, '结束进程', 'warning');
                    if (!confirmed) return;
                    try {
                        await api.KillProcessByPID(pid);
                        toast('进程已终止', 'info');
                        // 重新检测
                        setTimeout(async () => {
                            const recheck = await api.CheckPortInUse(port);
                            if (!recheck) {
                                result.innerHTML = `<div class="port-result-row"><span class="port-free">端口 ${port} 当前空闲，无进程占用</span></div>`;
                            }
                        }, 1000);
                    } catch (err) {
                        toast('终止进程失败: ' + (err.message || err), 'error');
                    }
                });
            }
        } catch (e) {
            toast('检测失败: ' + (e.message || e), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '检测';
        }
    });

    // 添加项目/分组
    document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal());

    document.getElementById('btn-add-group').addEventListener('click', () => {
        document.getElementById('group-id').value = '';
        document.getElementById('group-name').value = '';
        openModal('modal-group');
    });

    // 浏览按钮
    document.getElementById('btn-browse-command').addEventListener('click', async () => {
        try {
            const path = await api.SelectExecutable();
            if (path) document.getElementById('proj-command').value = path;
        } catch (e) { toast('选择文件失败', 'error'); }
    });

    document.getElementById('btn-browse-workdir').addEventListener('click', async () => {
        try {
            const path = await api.SelectFolder('选择工作目录');
            if (path) document.getElementById('proj-workdir').value = path;
        } catch (e) { toast('选择目录失败', 'error'); }
    });

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
        try {
            await api.DeleteProject(state.selectedProjectId);
            toast('项目已删除', 'success');
            state.selectedProjectId = null;
            showView('dashboard');
            await refreshData();
        } catch (e) { toast('删除失败', 'error'); }
    });

    // 日志筛选
    document.getElementById('log-source-filter').addEventListener('change', (e) => {
        state.logFilter = e.target.value;
        loadLogs();
    });

    document.querySelectorAll('#log-level-filters .log-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#log-level-filters .log-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.logLevelFilter = btn.getAttribute('data-level');
            loadLogs();
        });
    });

    document.getElementById('btn-clear-logs').addEventListener('click', async () => {
        await api.ClearLogs(state.selectedProjectId);
        await loadLogs();
        toast('日志已清空', 'success');
    });

    // 全部启动/停止
    document.getElementById('btn-start-all').addEventListener('click', async () => {
        for (const p of state.projects) {
            if (p.status !== 'running') {
                try { await api.StartProject(p.id); } catch (e) { /* ignore */ }
            }
        }
        toast('已启动所有项目', 'success');
        await refreshData();
    });

    document.getElementById('btn-stop-all').addEventListener('click', async () => {
        for (const p of state.projects) {
            if (p.status === 'running') {
                try { await api.StopProject(p.id); } catch (e) { /* ignore */ }
            }
        }
        toast('已停止所有项目', 'info');
        await refreshData();
    });

    // 主题切换 — 即时应用并保存
    function setTheme(theme) {
        currentSavedTheme = theme;
        // 添加过渡类，让所有元素平滑切换
        document.body.classList.add('theme-transitioning');
        applyTheme(theme);
        document.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('active'));
        const btn = document.getElementById('theme-' + theme);
        if (btn) btn.classList.add('active');
        saveSettingsNow(theme);
        // 过渡完成后移除类
        setTimeout(() => document.body.classList.remove('theme-transitioning'), 350);
    }

    document.getElementById('theme-light').addEventListener('click', () => setTheme('light'));
    document.getElementById('theme-dark').addEventListener('click', () => setTheme('dark'));
    document.getElementById('theme-auto').addEventListener('click', () => setTheme('auto'));

    // 设置开关 — 即时保存
    ['setting-minimize-tray', 'setting-start-boot', 'setting-auto-restart'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => saveSettingsNow());
    });
    document.getElementById('setting-max-restart').addEventListener('change', () => saveSettingsNow());

    // 日志中的链接点击 — 在系统浏览器中打开
    document.getElementById('log-content').addEventListener('click', (e) => {
        const link = e.target.closest('[data-url]');
        if (link) {
            e.preventDefault();
            const url = link.getAttribute('data-url');
            if (api.OpenURL) {
                api.OpenURL(url).catch(() => {});
            }
        }
    });

    // 模态框关闭
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.getAttribute('data-modal')));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal('modal-project');
            closeModal('modal-group');
        }
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            openProjectModal();
        }
    });

    // Wails 实时日志事件
    if (wailsRuntime) {
        wailsRuntime.EventsOn('log', (entry) => {
            if (state.currentView === 'project' && state.selectedProjectId === entry.projectId) {
                if (state.logFilter && entry.source !== state.logFilter) return;
                if (state.logLevelFilter && entry.level !== state.logLevelFilter) return;

                const content = document.getElementById('log-content');
                if (content) {
                    const empty = content.querySelector('.empty-state');
                    if (empty) empty.remove();

                    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
                    const lvl = entry.level || 'info';
                    const line = document.createElement('div');
                    line.className = 'log-entry';
                    line.innerHTML = `<span class="log-time">${time}</span><span class="log-level ${esc(lvl)}">${esc(lvl.toUpperCase())}</span><span class="log-source">${esc(entry.source)}</span><span class="log-message">${linkifyText(entry.text)}</span>`;
                    content.appendChild(line);
                    content.scrollTop = content.scrollHeight;
                }
            }
        });

        // 停止超时事件：进程 5 秒内未退出且无日志活动，弹窗询问是否强杀
        wailsRuntime.EventsOn('stop-timeout', async (projectID) => {
            const p = state.projects.find(x => x.id === projectID);
            const name = p ? p.name : projectID;
            const confirmed = await showConfirm(`「${name}」在 5 秒内未能正常退出，是否强制终止？`, '强制终止', 'warning');
            if (confirmed) {
                try {
                    await api.ForceStopProject(projectID);
                    toast(`${name} 已强制终止`, 'info');
                } catch (e) {
                    toast('强制终止失败: ' + (e.message || e), 'error');
                }
                await refreshData();
            }
        });

        // 端口冲突事件：进程崩溃后端口仍被占用
        wailsRuntime.EventsOn('port-conflict', async (data) => {
            const p = state.projects.find(x => x.id === data.projectId);
            const name = p ? p.name : data.projectId;
            const confirmed = await showDialog({
                title: '端口被占用',
                message: `端口 <strong>${data.port}</strong> 被「<strong>${esc(data.processName)}</strong>」(PID: ${data.pid}) 占用<br>这可能导致「${esc(name)}」无法正常启动`,
                type: 'warning',
                confirmText: '强制结束',
                cancelText: '忽略',
                danger: true,
            });
            if (confirmed) {
                try {
                    await api.KillProcessByPID(data.pid);
                    toast(`已终止 ${data.processName} (PID: ${data.pid})`, 'success');
                    // 尝试重新启动项目
                    if (p) {
                        await api.StartProject(data.projectId);
                        toast(`正在重新启动「${name}」...`, 'info');
                    }
                } catch (e) {
                    toast('终止进程失败: ' + (e.message || e), 'error');
                }
                await refreshData();
            }
        });
    }
    const gtip = document.getElementById('global-tooltip');
    document.addEventListener('mouseover', (e) => {
        const tip = e.target.closest('.info-tip');
        if (!tip || !tip.dataset.tooltip) return;
        gtip.textContent = tip.dataset.tooltip;
        gtip.classList.add('visible');
        const rect = tip.getBoundingClientRect();
        // 默认显示在图标上方
        let top = rect.top - 8;
        let left = rect.left + rect.width / 2;
        gtip.style.left = left + 'px';
        gtip.style.top = top + 'px';
        gtip.style.transform = 'translate(-50%, -100%)';
        // 如果上方空间不足，改显示在下方
        const tipRect = gtip.getBoundingClientRect();
        if (tipRect.top < 4) {
            gtip.style.top = (rect.bottom + 8) + 'px';
            gtip.style.transform = 'translate(-50%, 0)';
        }
        // 水平边界修正
        const tr2 = gtip.getBoundingClientRect();
        if (tr2.left < 4) {
            gtip.style.left = (tr2.width / 2 + 4) + 'px';
        } else if (tr2.right > window.innerWidth - 4) {
            gtip.style.left = (window.innerWidth - tr2.width / 2 - 4) + 'px';
        }
    });
    document.addEventListener('mouseout', (e) => {
        const tip = e.target.closest('.info-tip');
        if (!tip) return;
        gtip.classList.remove('visible');
    });

    // ═══════════ 数据刷新速度 ═══════════
    document.getElementById('refresh-speed-options').addEventListener('click', (e) => {
        const btn = e.target.closest('.refresh-speed-btn');
        if (!btn) return;
        const speed = parseInt(btn.dataset.speed, 10);
        if (isNaN(speed)) return;

        // 更新 active 状态
        document.querySelectorAll('.refresh-speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 重建轮询
        startDashboardPolling(speed);
    });

    // ═══════════ 命令输入 ═══════════
    const cmdInput = document.getElementById('log-command-input');
    const cmdSendBtn = document.getElementById('btn-send-command');

    async function sendCommandToProject() {
        const cmd = cmdInput.value.trim();
        if (!cmd) return;
        const pid = state.selectedProjectId;
        if (!pid) return;
        try {
            const err = await api.SendCommand(pid, cmd);
            if (err) {
                console.error('[SendCommand] 发送失败:', err);
            }
            cmdInput.value = '';
            // 刷新日志以显示发送的命令
            setTimeout(() => loadLogs(), 100);
        } catch (e) {
            console.error('[SendCommand] 异常:', e);
        }
    }

    cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendCommandToProject();
        }
    });

    cmdSendBtn.addEventListener('click', () => {
        sendCommandToProject();
    });

    // ═══════════ 终端面板 ═══════════
    const termPanel = document.getElementById('terminal-panel');
    const termOutput = document.getElementById('terminal-output');
    const termInput = document.getElementById('terminal-input');
    const termBtn = document.getElementById('btn-toggle-terminal');
    const logPanel = termPanel.closest('.log-panel');

    // 切换终端面板
    termBtn.addEventListener('click', () => {
        const isActive = logPanel.classList.toggle('terminal-active');
        termBtn.classList.toggle('active', isActive);
        if (isActive) {
            updateTerminalOutput();
            termInput.focus();
        }
    });

    // 终端输入 → 发送命令
    termInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = termInput.value.trim();
            if (!cmd) return;
            const pid = state.selectedProjectId;
            if (!pid) return;

            // 在终端输出中显示发送的命令
            appendTermLine(cmd, 'cmd');
            termInput.value = '';

            try {
                await api.SendCommand(pid, cmd);
            } catch (err) {
                appendTermLine('发送失败: ' + err, 'err');
            }
            // 延迟刷新终端输出以捕获响应
            setTimeout(() => updateTerminalOutput(), 200);
        }
    });
}

// 更新终端输出（从日志中提取 stdout/stderr/stdin 内容）
async function updateTerminalOutput() {
    if (!state.selectedProjectId) return;
    const termOutput = document.getElementById('terminal-output');
    if (!termOutput) return;

    try {
        const logs = await api.GetLogs(state.selectedProjectId, 500);
        if (!logs || logs.length === 0) return;

        const wasAtBottom = termOutput.scrollHeight - termOutput.scrollTop - termOutput.clientHeight < 30;

        termOutput.innerHTML = logs.map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
            const text = esc(entry.text);
            if (entry.source === 'stdin') {
                return `<div class="term-line cmd">${esc(entry.text)}</div>`;
            } else if (entry.source === 'stderr') {
                return `<div class="term-line err">${text}</div>`;
            } else if (entry.source === 'system') {
                return `<div class="term-line sys">${time} ${text}</div>`;
            }
            return `<div class="term-line">${text}</div>`;
        }).join('');

        if (wasAtBottom) {
            termOutput.scrollTop = termOutput.scrollHeight;
        }
    } catch (e) { /* ignore */ }
}

// 向终端追加一行
function appendTermLine(text, className) {
    const termOutput = document.getElementById('terminal-output');
    if (!termOutput) return;
    const div = document.createElement('div');
    div.className = 'term-line' + (className ? ' ' + className : '');
    div.textContent = text;
    termOutput.appendChild(div);
    termOutput.scrollTop = termOutput.scrollHeight;
}

// ========== 定时刷新 ==========
let dashboardIntervalId = null;
let currentRefreshSpeed = 2000;

function startDashboardPolling(speed) {
    if (dashboardIntervalId) clearInterval(dashboardIntervalId);
    currentRefreshSpeed = speed;
    dashboardIntervalId = setInterval(async () => {
        // 项目状态刷新（所有视图都需要）
        try {
            state.projects = await api.GetProjects() || [];
            renderSidebar();
            if (state.currentView === 'project') {
                const p = state.projects.find(x => x.id === state.selectedProjectId);
                if (p) {
                    const statusEl = document.getElementById('detail-status');
                    const sc = p.status || 'stopped';
                    statusEl.className = 'detail-status-badge ' + sc;
                    statusEl.innerHTML = `<span class="status-dot ${sc}"></span><span>${getStatusLabel(sc)}</span>`;

                    // 重置按钮状态（防止卡在"处理中…"）
                    const btnStart = document.getElementById('btn-detail-start');
                    const btnStop = document.getElementById('btn-detail-stop');
                    const btnRestart = document.getElementById('btn-detail-restart');

                    btnStart.style.display = (sc === 'running' || sc === 'starting') ? 'none' : '';
                    btnStop.style.display = (sc === 'running' || sc === 'starting') ? '' : 'none';
                    btnRestart.style.display = (sc === 'running' || sc === 'starting') ? '' : 'none';

                    [btnStart, btnStop, btnRestart].forEach(btn => {
                        if (btn && btn.classList.contains('btn-loading')) {
                            setBtnLoading(btn, false);
                        }
                    });

                    // 更新进程信息卡片
                    if (sc === 'running' || sc === 'starting') {
                        try {
                            const info = await api.GetProcessInfo(p.id);
                            const infoGrid = document.getElementById('info-grid');
                            if (infoGrid && info) {
                                const portEl = infoGrid.querySelector('[data-field="port"]');
                                if (portEl) portEl.textContent = info.port || p.port || '—';

                                const pidEl = infoGrid.querySelector('[data-field="pid"]');
                                if (pidEl) pidEl.textContent = info.pid || p.pid || '—';

                                const uptimeEl = infoGrid.querySelector('[data-field="uptime"]');
                                if (uptimeEl) uptimeEl.textContent = info.uptime ? formatUptime(info.uptime) : '—';

                                const memEl = infoGrid.querySelector('[data-field="memory"]');
                                if (memEl) memEl.textContent = info.memoryMB ? info.memoryMB.toFixed(1) + ' MB' : '—';

                                const cpuEl = infoGrid.querySelector('[data-field="cpu"]');
                                if (cpuEl) cpuEl.textContent = (info.cpuPercent != null && info.cpuPercent >= 0) ? info.cpuPercent.toFixed(1) + '%' : '—';

                                const restartEl = infoGrid.querySelector('[data-field="restart"]');
                                if (restartEl) restartEl.textContent = info.restartCount ?? 0;
                            }
                        } catch (e2) { /* ignore */ }
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // 仪表盘专属刷新（仅 dashboard 视图）
        if (state.currentView === 'dashboard') {
            updateSystemMonitor();
            updateTopProcesses();
            updateLogStats();
        }

        // 终端面板自动刷新（项目视图 + 终端已开启）
        if (state.currentView === 'project') {
            const lp = document.querySelector('.log-panel');
            if (lp && lp.classList.contains('terminal-active')) {
                updateTerminalOutput();
            }
            // 同步刷新日志
            loadLogs();
        }
    }, speed);
}

function startPolling() {
    // 统一轮询，默认 2 秒，由刷新速度控件调整
    startDashboardPolling(2000);
}

// ========== 启动 ==========
async function main() {
    await initAPI();

    // 加载主题
    try {
        const s = await api.GetGlobalSettings();
        currentSavedTheme = s.theme || 'light';
        applyTheme(currentSavedTheme);
    } catch (e) { /* ignore */ }

    bindEvents();
    await refreshData();
    showView('dashboard');
    startPolling();
}

main();
