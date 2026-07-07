// ========== Sliect Launcher — 计划任务模块（Phase 4） ==========
// 负责：任务列表渲染、增删改查、立即执行、执行日志查看

import { state, esc, toast, showConfirm } from './core.js';
import { getAPI, getWailsRuntime } from './api-bridge.js';

const schedulerState = {
    tasks: [],
    projects: [],
    logTaskId: null,
    logEntries: [],
    logAutoScroll: true,
};

// cron 表达式预设
const CRON_PRESETS = [
    { label: '每分钟', expr: '* * * * *' },
    { label: '每 5 分钟', expr: '*/5 * * * *' },
    { label: '每 30 分钟', expr: '*/30 * * * *' },
    { label: '每小时', expr: '0 * * * *' },
    { label: '每天 00:00', expr: '0 0 * * *' },
    { label: '每天 03:00', expr: '0 3 * * *' },
    { label: '每周一 00:00', expr: '0 0 * * 1' },
    { label: '每月 1 日 00:00', expr: '0 0 1 * *' },
];

// ========== 渲染 ==========

// 加载任务和项目数据
export async function loadSchedulerData() {
    const api = getAPI();
    try {
        const [tasks, projects] = await Promise.all([
            api.GetTasks(),
            api.GetProjects(),
        ]);
        schedulerState.tasks = Array.isArray(tasks) ? tasks : [];
        schedulerState.projects = Array.isArray(projects) ? projects : [];
    } catch (e) {
        console.error('加载计划任务数据失败:', e);
        schedulerState.tasks = [];
        schedulerState.projects = state.projects || [];
    }
}

// 渲染计划任务视图
export async function renderSchedulerView() {
    await loadSchedulerData();
    renderTaskList();
}

// 渲染任务列表
function renderTaskList() {
    const container = document.getElementById('scheduler-task-list');
    if (!container) return;

    if (schedulerState.tasks.length === 0) {
        container.innerHTML = `
            <div class="placeholder-state">
                <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <h2 class="placeholder-title">还没有计划任务</h2>
                <p class="placeholder-desc">基于 cron 表达式的定时任务，可定时启动项目、执行脚本，超时自动终止进程树。</p>
                <button class="btn btn-primary" id="btn-empty-add-task">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    创建第一个任务
                </button>
            </div>
        `;
        const btn = document.getElementById('btn-empty-add-task');
        if (btn) btn.addEventListener('click', () => openTaskModal());
        return;
    }

    // 按 sortOrder 排序
    const sorted = [...schedulerState.tasks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    container.innerHTML = sorted.map(t => {
        const project = schedulerState.projects.find(p => p.id === t.projectId);
        const projectName = project ? project.name : (t.projectId || '—');
        return renderTaskCard(t, projectName);
    }).join('');

    // 绑定卡片事件
    container.querySelectorAll('[data-task-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.taskAction;
            const id = btn.dataset.taskId;
            handleTaskAction(action, id);
        });
    });

    // 启用/禁用开关
    container.querySelectorAll('.task-enable-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const id = toggle.dataset.taskId;
            const enabled = toggle.checked;
            toggleTaskEnabled(id, enabled);
        });
    });
}

// 渲染单个任务卡片
function renderTaskCard(t, projectName) {
    const status = t.lastStatus || '';
    const statusBadge = renderStatusBadge(status);
    const lastRun = t.lastRunAt ? formatRelativeTime(t.lastRunAt) : '从未执行';
    const duration = t.lastDuration ? formatDuration(t.lastDuration) : '';
    const timeoutText = t.timeout > 0 ? `${t.timeout}s 超时` : '不超时';
    const cronDesc = describeCronExpr(t.cronExpr);

    return `
        <div class="task-card ${t.enabled ? '' : 'disabled'}">
            <div class="task-card-header">
                <div class="task-card-title-row">
                    <label class="toggle task-enable-toggle" title="${t.enabled ? '已启用' : '已禁用'}">
                        <input type="checkbox" ${t.enabled ? 'checked' : ''} data-task-id="${esc(t.id)}" />
                        <span class="toggle-track"></span>
                    </label>
                    <h3 class="task-card-name">${esc(t.name)}</h3>
                    ${statusBadge}
                </div>
                <div class="task-card-actions">
                    <button class="btn btn-ghost btn-xs" data-task-action="run" data-task-id="${esc(t.id)}" title="立即执行">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        执行
                    </button>
                    <button class="btn btn-ghost btn-xs" data-task-action="logs" data-task-id="${esc(t.id)}" title="执行日志">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        日志
                    </button>
                    <button class="btn btn-ghost btn-xs" data-task-action="edit" data-task-id="${esc(t.id)}" title="编辑">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn btn-danger-ghost btn-xs" data-task-action="delete" data-task-id="${esc(t.id)}" title="删除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
            <div class="task-card-body">
                <div class="task-card-meta">
                    <div class="task-meta-item">
                        <span class="task-meta-label">Cron 表达式</span>
                        <code class="task-meta-value task-cron-code">${esc(t.cronExpr)}</code>
                    </div>
                    <div class="task-meta-item">
                        <span class="task-meta-label">目标项目</span>
                        <span class="task-meta-value">${esc(projectName)}</span>
                    </div>
                    <div class="task-meta-item">
                        <span class="task-meta-label">超时</span>
                        <span class="task-meta-value">${timeoutText}</span>
                    </div>
                </div>
                ${cronDesc ? `<div class="task-card-cron-desc">${esc(cronDesc)}</div>` : ''}
            </div>
            <div class="task-card-footer">
                <span class="task-last-run">上次执行：${lastRun}${duration ? ` · ${duration}` : ''}</span>
            </div>
        </div>
    `;
}

// 渲染状态徽章
function renderStatusBadge(status) {
    if (!status) return '';
    const map = {
        success: { cls: 'success', text: '成功' },
        failed: { cls: 'error', text: '失败' },
        timeout: { cls: 'warning', text: '超时' },
        running: { cls: 'info', text: '运行中' },
        skipped: { cls: 'muted', text: '跳过' },
    };
    const m = map[status] || { cls: 'muted', text: status };
    return `<span class="task-status-badge ${m.cls}">${m.text}</span>`;
}

// ========== 任务操作 ==========

async function handleTaskAction(action, id) {
    if (action === 'run') return runTaskNow(id);
    if (action === 'logs') return openLogViewer(id);
    if (action === 'edit') return openTaskModal(id);
    if (action === 'delete') return deleteTask(id);
}

// 切换任务启用状态
async function toggleTaskEnabled(id, enabled) {
    const api = getAPI();
    const t = schedulerState.tasks.find(x => x.id === id);
    if (!t) return;
    try {
        await api.UpdateTask({
            id: t.id,
            name: t.name,
            cronExpr: t.cronExpr,
            projectId: t.projectId,
            timeout: t.timeout,
            enabled: enabled,
        });
        toast(`任务「${t.name}」已${enabled ? '启用' : '禁用'}`, 'success');
        await loadSchedulerData();
        renderTaskList();
    } catch (e) {
        toast('更新任务失败: ' + (e.message || e), 'error');
        await loadSchedulerData();
        renderTaskList();
    }
}

// 立即执行任务
async function runTaskNow(id) {
    const api = getAPI();
    const t = schedulerState.tasks.find(x => x.id === id);
    if (!t) return;
    try {
        await api.RunTaskNow(id);
        toast(`任务「${t.name}」已触发执行`, 'info');
    } catch (e) {
        toast('执行失败: ' + (e.message || e), 'error');
    }
}

// 删除任务
async function deleteTask(id) {
    const t = schedulerState.tasks.find(x => x.id === id);
    if (!t) return;
    const confirmed = await showConfirm(
        `确定删除任务「${t.name}」？此操作不可撤销。`,
        '删除任务',
        'warning'
    );
    if (!confirmed) return;
    const api = getAPI();
    try {
        await api.DeleteTask(id);
        toast(`任务「${t.name}」已删除`, 'success');
        await loadSchedulerData();
        renderTaskList();
    } catch (e) {
        toast('删除失败: ' + (e.message || e), 'error');
    }
}

// ========== 任务编辑模态框 ==========

function openTaskModal(id = null) {
    const isEdit = !!id;
    const t = isEdit ? schedulerState.tasks.find(x => x.id === id) : null;

    const modal = document.getElementById('modal-task');
    if (!modal) return;

    document.getElementById('modal-task-title').textContent = isEdit ? '编辑任务' : '添加任务';
    document.getElementById('task-id').value = t ? t.id : '';
    document.getElementById('task-id').disabled = isEdit;
    document.getElementById('task-name').value = t ? t.name : '';
    document.getElementById('task-cron').value = t ? t.cronExpr : '';
    document.getElementById('task-project').value = t ? t.projectId : '';
    document.getElementById('task-timeout').value = t ? t.timeout : 0;
    document.getElementById('task-enabled').checked = t ? t.enabled : true;

    // 渲染项目下拉
    const projSelect = document.getElementById('task-project');
    projSelect.innerHTML = '<option value="">— 选择目标项目 —</option>' +
        schedulerState.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (t) projSelect.value = t.projectId;

    // 渲染 cron 预设
    renderCronPresets();

    // 更新 cron 描述
    updateCronDescription();

    modal.classList.add('active');
}

// 渲染 cron 预设按钮
function renderCronPresets() {
    const container = document.getElementById('task-cron-presets');
    if (!container) return;
    container.innerHTML = CRON_PRESETS.map(p =>
        `<button type="button" class="cron-preset-btn" data-expr="${p.expr}" title="${p.label}">${esc(p.label)}</button>`
    ).join('');
    container.querySelectorAll('.cron-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('task-cron').value = btn.dataset.expr;
            updateCronDescription();
        });
    });
}

// 更新 cron 表达式描述
function updateCronDescription() {
    const input = document.getElementById('task-cron');
    const desc = document.getElementById('task-cron-desc');
    if (!input || !desc) return;
    desc.textContent = describeCronExpr(input.value);
}

// 解析 cron 表达式为人类可读描述
function describeCronExpr(expr) {
    if (!expr) return '';
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return '需要 5 个字段：分 时 日 月 周';
    const [min, hour, day, month, week] = parts;
    // 简化描述
    if (min === '*' && hour === '*') return '每分钟执行';
    if (/^\*\/(\d+)$/.test(min) && hour === '*') {
        const m = min.match(/^\*\/(\d+)$/);
        return `每 ${m[1]} 分钟执行`;
    }
    if (min === '0' && hour === '*') return '每小时整点执行';
    if (/^\*\/(\d+)$/.test(hour) && min === '0') {
        const m = hour.match(/^\*\/(\d+)$/);
        return `每 ${m[1]} 小时执行`;
    }
    if (min === '0' && hour === '0' && day === '*' && month === '*') return '每天 00:00 执行';
    if (min === '0' && /^\d+$/.test(hour) && day === '*' && month === '*') {
        return `每天 ${hour.padStart(2, '0')}:${min.padStart(2, '0')} 执行`;
    }
    if (min === '0' && hour === '0' && day === '*' && month === '*' && /^\d+$/.test(week)) {
        const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return `每${weekNames[parseInt(week) % 7]} 00:00 执行`;
    }
    if (min === '0' && hour === '0' && day === '1' && month === '*') return '每月 1 日 00:00 执行';
    return `自定义：${expr}`;
}

// 保存任务
async function saveTask() {
    const id = document.getElementById('task-id').value.trim();
    const name = document.getElementById('task-name').value.trim();
    const cronExpr = document.getElementById('task-cron').value.trim();
    const projectId = document.getElementById('task-project').value;
    const timeout = parseInt(document.getElementById('task-timeout').value) || 0;
    const enabled = document.getElementById('task-enabled').checked;

    if (!id) { toast('请输入任务 ID', 'warning'); return; }
    if (!name) { toast('请输入任务名称', 'warning'); return; }
    if (!cronExpr) { toast('请输入 Cron 表达式', 'warning'); return; }
    if (!projectId) { toast('请选择目标项目', 'warning'); return; }

    const api = getAPI();
    const input = { id, name, cronExpr, projectId, timeout, enabled };
    const isEdit = document.getElementById('task-id').disabled;

    try {
        if (isEdit) {
            await api.UpdateTask(input);
            toast(`任务「${name}」已更新`, 'success');
        } else {
            await api.AddTask(input);
            toast(`任务「${name}」已创建`, 'success');
        }
        closeModal('modal-task');
        await loadSchedulerData();
        renderTaskList();
    } catch (e) {
        toast('保存失败: ' + (e.message || e), 'error');
    }
}

// 关闭模态框
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
}

// ========== 执行日志查看器 ==========

async function openLogViewer(taskId) {
    const t = schedulerState.tasks.find(x => x.id === taskId);
    if (!t) return;
    schedulerState.logTaskId = taskId;
    schedulerState.logAutoScroll = true;

    const modal = document.getElementById('modal-task-logs');
    if (!modal) return;
    document.getElementById('task-logs-title').textContent = `执行日志 · ${t.name}`;

    await refreshTaskLogs();
    modal.classList.add('active');
}

async function refreshTaskLogs() {
    if (!schedulerState.logTaskId) return;
    const api = getAPI();
    try {
        const logs = await api.GetTaskLogs(schedulerState.logTaskId);
        schedulerState.logEntries = Array.isArray(logs) ? logs : [];
        renderTaskLogs();
    } catch (e) {
        console.error('加载任务日志失败:', e);
    }
}

function renderTaskLogs() {
    const container = document.getElementById('task-logs-content');
    if (!container) return;
    if (schedulerState.logEntries.length === 0) {
        container.innerHTML = `<div class="task-logs-empty">暂无执行记录</div>`;
        return;
    }
    // 按时间降序（最新在顶部）
    const sorted = [...schedulerState.logEntries].sort((a, b) => b.startedAt - a.startedAt);
    container.innerHTML = sorted.map(log => {
        const statusCls = log.status || 'muted';
        const statusText = { success: '成功', failed: '失败', timeout: '超时', running: '运行中', skipped: '跳过' }[log.status] || log.status;
        const startStr = new Date(log.startedAt).toLocaleString('zh-CN', { hour12: false });
        const durationStr = log.duration ? formatDuration(log.duration) : '—';
        const endStr = log.endedAt ? new Date(log.endedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '进行中';
        return `
            <div class="task-log-item ${statusCls}">
                <div class="task-log-header">
                    <span class="task-log-status ${statusCls}">${statusText}</span>
                    <span class="task-log-time">${esc(startStr)} → ${esc(endStr)}</span>
                    <span class="task-log-duration">${durationStr}</span>
                </div>
                <div class="task-log-message">${esc(log.message || '')}</div>
            </div>
        `;
    }).join('');

    // 自动滚动到顶部（最新在顶部）
    if (schedulerState.logAutoScroll) {
        container.scrollTop = 0;
    }
}

// ========== 事件绑定 ==========

export function bindSchedulerEvents() {
    // 添加任务按钮
    const addBtn = document.getElementById('btn-add-task');
    if (addBtn) addBtn.addEventListener('click', () => openTaskModal());

    // 保存任务
    const saveBtn = document.getElementById('btn-save-task');
    if (saveBtn) saveBtn.addEventListener('click', saveTask);

    // cron 输入实时描述
    const cronInput = document.getElementById('task-cron');
    if (cronInput) cronInput.addEventListener('input', updateCronDescription);

    // 日志查看器关闭
    const logClose = document.getElementById('task-logs-close');
    if (logClose) logClose.addEventListener('click', () => closeModal('modal-task-logs'));

    const logRefresh = document.getElementById('task-logs-refresh');
    if (logRefresh) logRefresh.addEventListener('click', refreshTaskLogs);

    // Wails 事件：任务执行完成
    const rt = getWailsRuntime();
    if (rt) {
        rt.EventsOn('scheduler:completed', (data) => {
            // 刷新任务列表（更新 lastStatus）
            if (document.getElementById('view-scheduler')?.classList.contains('active')) {
                loadSchedulerData().then(renderTaskList);
            }
            // 若日志查看器打开，刷新日志
            if (schedulerState.logTaskId === data?.taskId) {
                refreshTaskLogs();
            }
            // 弹通知
            const statusMap = { success: 'success', failed: 'error', timeout: 'warning', skipped: 'info' };
            toast(`任务「${data?.name}」${data?.status === 'success' ? '执行完成' : '执行' + (data?.status || '')}`,
                statusMap[data?.status] || 'info');
        });

        rt.EventsOn('scheduler:started', (data) => {
            if (document.getElementById('view-scheduler')?.classList.contains('active')) {
                loadSchedulerData().then(renderTaskList);
            }
        });
    }
}

// 轮询钩子：当前视图是 scheduler 时刷新任务列表
export async function refreshSchedulerForPoll() {
    const view = document.getElementById('view-scheduler');
    if (!view || !view.classList.contains('active')) return;
    // 静默刷新数据（不重新渲染，避免打断用户操作）
    const api = getAPI();
    try {
        const tasks = await api.GetTasks();
        const prev = JSON.stringify(schedulerState.tasks.map(t => `${t.id}:${t.lastStatus}:${t.lastRunAt}`));
        schedulerState.tasks = Array.isArray(tasks) ? tasks : [];
        const now = JSON.stringify(schedulerState.tasks.map(t => `${t.id}:${t.lastStatus}:${t.lastRunAt}`));
        // 仅在状态变化时重新渲染
        if (prev !== now) renderTaskList();
    } catch (e) { /* ignore */ }
}

// ========== 工具函数 ==========

function formatRelativeTime(ts) {
    if (!ts) return '从未执行';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 2592000000) return `${Math.floor(diff / 86400000)} 天前`;
    return new Date(ts).toLocaleDateString('zh-CN');
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m${s}s`;
}
