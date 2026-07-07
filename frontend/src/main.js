// ========== Sliect Launcher — 主入口 ==========
// 负责：模块编排、顶部导航、底部状态栏、全局事件、Wails 事件订阅

import { state, applyTheme, getCurrentSavedTheme, setCurrentSavedTheme, toast, showConfirm, showDialog, esc } from './core.js';
import { initAPI, getAPI, getWailsRuntime } from './api-bridge.js';
import {
    renderDashboard, renderStatCards, bindDashboardEvents,
    startPolling, registerPollHook, renderSysinfo, refreshSysinfoForPoll,
} from './dashboard.js';
import {
    renderSidebar, renderProjectGrid, selectProject, renderProjectDetail,
    bindProjectsEvents, refreshData, refreshProjectsForPoll,
    showView, openModal, closeModal, openProjectModal,
    startProject, stopProject, restartProject,
} from './projects.js';
import { bindLogEvents, loadLogs, appendLogEntry, refreshLogsForPoll, renderGlobalLogsView } from './logviewer.js';
import { bindTerminalEvents, refreshTerminalForPoll } from './terminal.js';
import { renderSettings, bindSettingsEvents } from './settings.js';
import { bindSchedulerEvents, renderSchedulerView, refreshSchedulerForPoll } from './scheduler.js';
import { bindPortsEvents, renderPortsView, refreshPortsForPoll } from './ports.js';
import { formatUptimeShort, formatBytes } from './core.js';

// ========== 顶部导航 ==========
const NAV_TABS = [
    { id: 'dashboard', label: '仪表盘', icon: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>' },
    { id: 'projects', label: '项目管理', icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>' },
    { id: 'logs', label: '日志查看', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>' },
    { id: 'sysinfo', label: '系统信息', icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="15" x2="22" y2="15"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/>' },
    { id: 'scheduler', label: '计划任务', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { id: 'ports', label: '端口管理', icon: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>' },
];

function renderTopNav() {
    const nav = document.getElementById('topnav-tabs');
    if (!nav) return;
    nav.innerHTML = NAV_TABS.map(t => `
        <button class="topnav-item" id="nav-tab-${t.id}" data-view="${t.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
            <span>${t.label}</span>
        </button>
    `).join('');

    nav.addEventListener('click', (e) => {
        const item = e.target.closest('.topnav-item');
        if (!item) return;
        const view = item.dataset.view;
        switchView(view);
    });
}

// 切换视图（顶部 Nav 专用入口）
async function switchView(view) {
    if (view === 'settings') {
        showView('settings');
        await renderSettings();
        return;
    }
    // 通知中心 Bell
    if (view === 'notifications') {
        openNotificationCenter();
        return;
    }
    showView(view);
    if (view === 'dashboard') {
        renderDashboard();
        renderProjectGrid();
    }
    if (view === 'projects') {
        renderProjectGrid();
    }
    if (view === 'logs') {
        renderGlobalLogsView();
    }
    if (view === 'sysinfo') {
        renderSysinfo();
    }
    if (view === 'scheduler') {
        renderSchedulerView();
    }
    if (view === 'ports') {
        renderPortsView();
    }
}

// 顶部右侧：通知 Bell + 设置
function bindTopRightControls() {
    const bell = document.getElementById('nav-bell');
    if (bell) bell.addEventListener('click', () => openNotificationCenter());

    const settingsBtn = document.getElementById('nav-tab-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', () => switchView('settings'));
}

// ========== 底部状态栏 ==========
async function refreshStatusBar() {
    const runningEl = document.getElementById('statusbar-running');
    const memEl = document.getElementById('statusbar-mem');
    const uptimeEl = document.getElementById('statusbar-uptime');

    // 运行进程数
    const running = state.projects.filter(p => p.status === 'running').length;
    if (runningEl) {
        runningEl.innerHTML = `<span class="statusbar-dot running"></span>运行中 <strong>${running}</strong> / ${state.projects.length}`;
    }

    // 总内存占用（系统）
    if (memEl) {
        try {
            const api = getAPI();
            const s = await api.GetSystemStats();
            memEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="14"/><line x1="10" y1="10" x2="10" y2="14"/><line x1="14" y1="10" x2="14" y2="14"/><line x1="18" y1="10" x2="18" y2="14"/></svg>内存 <strong>${s.memPercent?.toFixed(0)}%</strong> <span class="statusbar-sub">${formatBytes(s.memUsed)}</span>`;
        } catch (e) { /* ignore */ }
    }

    // 面板运行时长
    if (uptimeEl) {
        const seconds = Math.floor((Date.now() - state.appStartTime) / 1000);
        uptimeEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>面板运行 <strong>${formatUptimeShort(seconds)}</strong>`;
    }
}

// ========== 通知中心（Phase 6 完整实现，此处先占位） ==========
const notifications = []; // {id, type, title, message, time, read, detail, timeline}

export function pushNotification(n) {
    // Phase 6：如果通知带 projectId 且已有同项目的崩溃通知，合并为时间线
    if (n.projectId) {
        const existing = notifications.find(x => x.projectId === n.projectId && x.type === 'error');
        if (existing) {
            // 追加到现有通知的时间线
            if (!existing.timeline) existing.timeline = [];
            existing.timeline.push({ time: n.time, event: n.title, message: n.message });
            existing.message = n.message; // 更新主消息为最新
            updateBellBadge();
            return;
        }
    }
    notifications.unshift({
        id: Date.now() + Math.random(), // 避免快速连发 id 冲突
        read: false,
        time: new Date().toISOString(),
        timeline: [],
        ...n,
    });
    updateBellBadge();
}

function updateBellBadge() {
    const badge = document.getElementById('nav-bell-badge');
    const unread = notifications.filter(n => !n.read).length;
    if (badge) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.style.display = unread > 0 ? '' : 'none';
    }
}

function openNotificationCenter() {
    const panel = document.getElementById('notification-panel');
    if (!panel) return;
    const list = document.getElementById('notification-list');
    if (!list) return;
    if (notifications.length === 0) {
        list.innerHTML = `<div class="notification-empty">暂无通知</div>`;
    } else {
        list.innerHTML = notifications.map(n => {
            const hasTimeline = n.timeline && n.timeline.length > 0;
            const timelineHtml = hasTimeline ? `
                <div class="notification-timeline" style="display:none;">
                    ${n.timeline.map(t => `
                        <div class="timeline-item">
                            <span class="timeline-time">${new Date(t.time).toLocaleString('zh-CN', { hour12: false })}</span>
                            <span class="timeline-event">${esc(t.event || '')}</span>
                            <span class="timeline-message">${esc(t.message || '')}</span>
                        </div>
                    `).join('')}
                </div>` : '';
            return `
            <div class="notification-item ${n.read ? '' : 'unread'}${hasTimeline ? ' expandable' : ''}" data-nid="${n.id}">
                <div class="notification-item-header">
                    <span class="notification-type ${n.type || 'info'}">${n.title || '通知'}</span>
                    <span class="notification-time">${new Date(n.time).toLocaleString('zh-CN', { hour12: false })}</span>
                </div>
                <div class="notification-message">${esc(n.message || '')}</div>
                ${hasTimeline ? '<div class="notification-expand-hint">点击展开时间线</div>' : ''}
                ${timelineHtml}
            </div>`;
        }).join('');
        // 标记已读
        notifications.forEach(n => n.read = true);
        updateBellBadge();

        // 绑定可展开通知的点击事件
        list.querySelectorAll('.notification-item.expandable').forEach(item => {
            item.addEventListener('click', () => {
                const timeline = item.querySelector('.notification-timeline');
                const hint = item.querySelector('.notification-expand-hint');
                if (timeline) {
                    const isShown = timeline.style.display !== 'none';
                    timeline.style.display = isShown ? 'none' : 'block';
                    if (hint) hint.textContent = isShown ? '点击展开时间线' : '点击收起';
                }
            });
        });
    }
    panel.classList.add('active');
}

function bindNotificationCenter() {
    const panel = document.getElementById('notification-panel');
    const closeBtn = document.getElementById('notification-close');
    if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.remove('active'));
    // 点击面板外部关闭
    document.addEventListener('click', (e) => {
        if (!panel) return;
        const bell = document.getElementById('nav-bell');
        if (panel.classList.contains('active') &&
            !panel.contains(e.target) && !bell?.contains(e.target)) {
            panel.classList.remove('active');
        }
    });
}

// ========== 全局事件（模态框关闭、键盘、Tooltip） ==========
function bindGlobalEvents() {
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
            closeModal('modal-task');
            closeModal('modal-task-logs');
            closeModal('modal-autostart-order');
            const np = document.getElementById('notification-panel');
            if (np) np.classList.remove('active');
            // Phase 5：关闭文件浏览面板
            const fb = document.getElementById('filebrowser-panel');
            if (fb) fb.style.display = 'none';
        }
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            openProjectModal();
        }
    });

    // 全局 Tooltip
    const gtip = document.getElementById('global-tooltip');
    if (gtip) {
        document.addEventListener('mouseover', (e) => {
            const tip = e.target.closest('.info-tip');
            if (!tip || !tip.dataset.tooltip) return;
            gtip.textContent = tip.dataset.tooltip;
            gtip.classList.add('visible');
            const rect = tip.getBoundingClientRect();
            let top = rect.top - 8;
            let left = rect.left + rect.width / 2;
            gtip.style.left = left + 'px';
            gtip.style.top = top + 'px';
            gtip.style.transform = 'translate(-50%, -100%)';
            const tipRect = gtip.getBoundingClientRect();
            if (tipRect.top < 4) {
                gtip.style.top = (rect.bottom + 8) + 'px';
                gtip.style.transform = 'translate(-50%, 0)';
            }
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
    }
}

// ========== Wails 实时事件 ==========
function bindWailsEvents() {
    const rt = getWailsRuntime();
    if (!rt) return;

    // 实时日志
    rt.EventsOn('log', (entry) => {
        appendLogEntry(entry);
    });

    // 停止超时：进程 5 秒内未退出且无日志活动，弹窗询问是否强杀
    rt.EventsOn('stop-timeout', async (projectID) => {
        const p = state.projects.find(x => x.id === projectID);
        const name = p ? p.name : projectID;
        const confirmed = await showConfirm(`「${name}」在 5 秒内未能正常退出，是否强制终止？`, '强制终止', 'warning');
        if (confirmed) {
            try {
                const api = getAPI();
                await api.ForceStopProject(projectID);
                toast(`${name} 已强制终止`, 'info');
            } catch (e) {
                toast('强制终止失败: ' + (e.message || e), 'error');
            }
            await refreshData();
        }
    });

    // 端口冲突事件：进程崩溃后端口仍被占用
    rt.EventsOn('port-conflict', async (data) => {
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
                const api = getAPI();
                await api.KillProcessByPID(data.pid);
                toast(`已终止 ${data.processName} (PID: ${data.pid})`, 'success');
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

    // 进程崩溃事件 → 推送通知中心（Phase 6 增强：含崩溃时间线）
    rt.EventsOn('process-crashed', (data) => {
        const exitTime = data.exitTime ? new Date(data.exitTime).toLocaleString('zh-CN', { hour12: false }) : new Date().toLocaleString('zh-CN', { hour12: false });
        pushNotification({
            type: 'error',
            title: '进程崩溃',
            projectId: data.projectId,
            name: data.name || data.projectId,
            message: `「${data.name || data.projectId}」已崩溃${data.willRestart ? '，即将自动重启' : '（未启用自动重启）'}${data.restartCount ? `（第 ${data.restartCount} 次重启）` : ''}`,
            timeline: [{
                time: data.exitTime || Date.now(),
                event: '崩溃',
                message: `${exitTime} - ${data.exitMsg || '进程异常退出'}`,
            }],
        });
    });

    // 进程自动重启事件 → 更新崩溃通知的时间线
    rt.EventsOn('process-restarted', (data) => {
        const restartTime = data.restartTime ? new Date(data.restartTime).toLocaleString('zh-CN', { hour12: false }) : new Date().toLocaleString('zh-CN', { hour12: false });
        pushNotification({
            type: 'success',
            title: '自动重启',
            projectId: data.projectId,
            name: data.name || data.projectId,
            message: `「${data.name || data.projectId}」已自动重启（第 ${data.restartCount} 次）`,
            timeline: [{
                time: data.restartTime || Date.now(),
                event: '重启',
                message: `${restartTime} - 已自动重启（第 ${data.restartCount} 次）`,
            }],
        });
    });
}

// ========== 启动 ==========
async function main() {
    await initAPI();

    // 加载主题
    try {
        const api = getAPI();
        const s = await api.GetGlobalSettings();
        setCurrentSavedTheme(s.theme || 'light');
        applyTheme(getCurrentSavedTheme());
    } catch (e) { /* ignore */ }

    // 渲染顶部导航
    renderTopNav();
    bindTopRightControls();
    bindNotificationCenter();

    // 绑定各模块事件
    bindDashboardEvents();
    bindProjectsEvents();
    bindLogEvents();
    bindTerminalEvents();
    bindSettingsEvents();
    bindSchedulerEvents();
    bindPortsEvents();
    bindGlobalEvents();
    bindWailsEvents();

    // 注册轮询钩子
    registerPollHook(refreshProjectsForPoll);
    registerPollHook(async () => {
        const { refreshDashboardForPoll } = await import('./dashboard.js');
        refreshDashboardForPoll();
    });
    registerPollHook(refreshLogsForPoll);
    registerPollHook(refreshTerminalForPoll);
    registerPollHook(refreshStatusBar);
    registerPollHook(refreshSysinfoForPoll);
    registerPollHook(refreshSchedulerForPoll);
    registerPollHook(refreshPortsForPoll);

    // 初始数据
    await refreshData();
    renderStatCards();
    renderProjectGrid();
    showView('dashboard');
    refreshStatusBar();
    startPolling();
}

main();
