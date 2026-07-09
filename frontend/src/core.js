// ========== Sliect Launcher — 核心共享模块 ==========
// 提供：全局状态、工具函数、Toast、自定义弹窗、主题、按钮加载态
// 所有功能模块均从此文件导入所需内容

import './style.css';
import './app.css';

// ========== 全局状态 ==========
export const state = {
    projects: [],
    groups: [],
    currentView: 'dashboard',
    selectedProjectId: null,
    editingProject: null,
    logFilter: '',          // 日志来源筛选
    logLevelFilter: '',     // 日志级别筛选
    logSearchQuery: '',     // 日志关键词搜索（Phase 3）
    autoScroll: true,       // 日志自动滚动（Phase 3：上滚暂停）
    searchQuery: '',        // 侧边栏项目搜索
    collapsedGroups: {},
    appStartTime: Date.now(), // 面板运行起点（用于状态栏运行时长）
};

// ========== 工具函数 ==========
export function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

export function formatUptime(seconds) {
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

export function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return val.toFixed(1) + ' ' + units[i];
}

// 将秒数格式化为简短的运行时长（用于状态栏：1天2时 / 3时12分 / 5分 / 12秒）
export function formatUptimeShort(seconds) {
    if (!seconds || seconds <= 0) return '0秒';
    if (seconds < 60) return `${Math.floor(seconds)}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分`;
    const h = Math.floor(seconds / 3600);
    if (h < 24) return `${h}时${Math.floor((seconds % 3600) / 60)}分`;
    const d = Math.floor(h / 24);
    return `${d}天${h % 24}时`;
}

export function getTypeInfo(type) {
    const map = {
        go: { label: 'Go', cls: 'type-go' },
        node: { label: 'Node.js', cls: 'type-node' },
        nodejs: { label: 'Node.js', cls: 'type-nodejs' },
        python: { label: 'Python', cls: 'type-python' },
        custom: { label: 'Custom', cls: 'type-custom' },
    };
    return map[type] || { label: type || '', cls: 'type-custom' };
}

export function getStatusLabel(status) {
    return { running: '运行中', stopped: '已停止', crashed: '异常', starting: '启动中', stopping: '停止中' }[status] || status || '未知';
}

// 将文本中的 URL 转换为可点击链接（先 HTML 转义，再替换 URL）
export function linkifyText(text) {
    const escaped = esc(text);
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    return escaped.replace(urlRegex, (url) => {
        return `<a href="#" data-url="${url}" class="log-link">${url}</a>`;
    });
}

// ========== 主题 ==========
let currentSavedTheme = 'light';

export function getCurrentSavedTheme() { return currentSavedTheme; }
export function setCurrentSavedTheme(t) { currentSavedTheme = t; }

// 主题应用：将 'auto' 解析为实际的 light/dark
export function applyTheme(theme) {
    const resolved = theme === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    return resolved;
}

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

// ========== Toast 通知 ==========
export function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
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

export function showDialog({ title = '提示', message = '', type = 'info', confirmText = '确定', cancelText = '取消', danger = false }) {
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

export function showConfirm(message, title = '确认', type = 'warning') {
    return showDialog({ title, message, type, confirmText: '确定', cancelText: '取消' });
}

// ========== 按钮加载态 & 即时状态反馈 ==========
export function setBtnLoading(btn, loading) {
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

export function setImmediateStatus(id, status) {
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

// ========== 通知中心（共享数据） ==========
// notifications 数组由 core.js 统一管理，main.js 负责渲染，所有模块通过 pushNotification 推送
export const notifications = []; // {id, type, title, message, time, read, projectId, name, timeline}

export function pushNotification(n) {
    // 确保时间字段存在（合并路径依赖此字段）
    if (!n.time) n.time = Date.now();
    // 如果通知带 projectId 且已有同项目的通知，合并为时间线
    if (n.projectId) {
        const existing = notifications.find(x => x.projectId === n.projectId && x.type === n.type);
        if (existing) {
            if (!existing.timeline) existing.timeline = [];
            existing.timeline.push({ time: n.time, event: n.title, message: n.message });
            existing.message = n.message; // 更新主消息为最新
            existing.time = n.time;       // 更新主时间为最新
            updateBellBadge();
            return;
        }
    }
    notifications.unshift({
        id: Date.now() + Math.random(), // 避免快速连发 id 冲突
        read: false,
        time: n.time,
        timeline: [],
        ...n,
    });
    updateBellBadge();
}

export function updateBellBadge() {
    const badge = document.getElementById('nav-bell-badge');
    const unread = notifications.filter(n => !n.read).length;
    if (badge) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.style.display = unread > 0 ? '' : 'none';
    }
}

export function getNotifications() {
    return notifications;
}

// 便捷方法：推送项目操作通知（统一格式，带时间轴）
export function notifyProjectAction(action, project, success, error) {
    const actionLabels = {
        start: '启动', stop: '停止', restart: '重启', 'force-stop': '强制终止',
    };
    const label = actionLabels[action] || action;
    const name = (typeof project === 'string') ? project : (project?.name || project?.id || '未知项目');
    const projectId = (typeof project === 'string') ? null : project?.id;
    const now = Date.now();
    const timeStr = new Date(now).toLocaleString('zh-CN', { hour12: false });
    const successMsg = success ? '成功' : `失败: ${error || '未知错误'}`;

    pushNotification({
        type: success ? 'success' : 'error',
        title: `${label}${success ? '成功' : '失败'}`,
        projectId: projectId,
        name: name,
        time: now,
        message: `「${name}」${label}${successMsg}`,
        timeline: [{
            time: now,
            event: label,
            message: `${timeStr} - ${successMsg}`,
        }],
    });
}
