// ========== Sliect Launcher — 日志查看模块 ==========
// 负责：项目日志加载、来源/级别筛选、渲染、链接化
// Phase 3：全局日志视图、实时搜索高亮、上滚暂停/回底恢复

import { state, esc } from './core.js';
import { getAPI } from './api-bridge.js';

// ========== 全局日志视图状态（独立于项目详情日志） ==========
const globalLogState = {
    search: '',           // 搜索关键词
    level: '',            // 级别筛选 '' | 'error' | 'warn' | 'info' | 'debug'
    projectId: '',        // 项目筛选 '' | projectId
    autoScroll: true,     // 自动滚动到底部
    logs: [],             // 缓存的日志数据
};

// ========== 关键词高亮 ==========
// 在已转义的文本上做高亮，跳过 HTML 标签内部
function formatLogText(rawText, query) {
    let s = esc(rawText);
    // 先链接化（在转义后的文本上）
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    s = s.replace(urlRegex, (url) => `<a href="#" data-url="${url}" class="log-link">${url}</a>`);
    // 再高亮关键词（仅在标签之间的文本段上）
    if (query) {
        const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (q) {
            const parts = s.split(/(<[^>]+>)/g);
            for (let i = 0; i < parts.length; i++) {
                if (parts[i].startsWith('<')) continue;
                parts[i] = parts[i].replace(new RegExp(`(${q})`, 'gi'), '<mark class="log-highlight">$1</mark>');
            }
            s = parts.join('');
        }
    }
    return s;
}

// ========== 项目详情日志渲染 ==========
function renderLogEntry(entry, query) {
    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    const lvl = entry.level || 'info';
    return `<div class="log-entry">
        <span class="log-time">${time}</span>
        <span class="log-level ${esc(lvl)}">${esc(lvl.toUpperCase())}</span>
        <span class="log-source">${esc(entry.source)}</span>
        <span class="log-message">${formatLogText(entry.text, query)}</span>
    </div>`;
}

// 全局日志条目渲染（带项目名）
function renderGlobalLogEntry(entry, query) {
    const time = new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false });
    const lvl = entry.level || 'info';
    return `<div class="log-entry global">
        <span class="log-time">${time}</span>
        <span class="log-level ${esc(lvl)}">${esc(lvl.toUpperCase())}</span>
        <span class="log-source" title="${esc(entry.projectName)}">${esc(entry.projectName)}</span>
        <span class="log-message">${formatLogText(entry.text, query)}</span>
    </div>`;
}

// 过滤项目详情日志（来源 + 级别 + 关键词）
function filterLogs(logs) {
    const srcFilter = state.logFilter;
    const lvlFilter = state.logLevelFilter || '';
    const q = state.logSearchQuery.toLowerCase();
    return logs.filter(l => {
        if (srcFilter && l.source !== srcFilter) return false;
        if (lvlFilter && l.level !== lvlFilter) return false;
        if (q && !String(l.text || '').toLowerCase().includes(q)) return false;
        return true;
    });
}

// 过滤全局日志（项目 + 级别 + 关键词）
function filterGlobalLogs(logs) {
    const lvl = globalLogState.level;
    const pid = globalLogState.projectId;
    const q = globalLogState.search.toLowerCase();
    return logs.filter(l => {
        if (pid && l.projectId !== pid) return false;
        if (lvl && l.level !== lvl) return false;
        if (q && !String(l.text || '').toLowerCase().includes(q)) return false;
        return true;
    });
}

// ========== 项目详情日志加载 ==========
export async function loadLogs() {
    if (!state.selectedProjectId) return;
    try {
        const api = getAPI();
        const logs = await api.GetLogs(state.selectedProjectId, 200);
        const content = document.getElementById('log-content');
        if (!content) return;

        if (!logs || logs.length === 0) {
            content.innerHTML = '<div class="empty-state" style="padding:32px"><p class="text-muted">暂无日志</p></div>';
            return;
        }

        const filtered = filterLogs(logs);
        if (filtered.length === 0) {
            content.innerHTML = '<div class="empty-state" style="padding:32px"><p class="text-muted">无匹配的日志</p></div>';
            return;
        }

        content.innerHTML = filtered.map(e => renderLogEntry(e, state.logSearchQuery)).join('');
        if (state.autoScroll) content.scrollTop = content.scrollHeight;
    } catch (e) {
        console.error('加载日志失败:', e);
    }
}

// 追加单条实时日志到项目详情（由 Wails Event 触发）
export function appendLogEntry(entry) {
    if (state.currentView !== 'project' || state.selectedProjectId !== entry.projectId) return;
    if (state.logFilter && entry.source !== state.logFilter) return;
    if (state.logLevelFilter && entry.level !== state.logLevelFilter) return;
    if (state.logSearchQuery && !String(entry.text || '').toLowerCase().includes(state.logSearchQuery.toLowerCase())) return;

    const content = document.getElementById('log-content');
    if (!content) return;
    const empty = content.querySelector('.empty-state');
    if (empty) empty.remove();

    const line = document.createElement('div');
    line.innerHTML = renderLogEntry(entry, state.logSearchQuery).trim();
    content.appendChild(line.firstChild);
    if (state.autoScroll) content.scrollTop = content.scrollHeight;
}

// ========== 全局日志视图（Phase 3） ==========
export async function loadGlobalLogs() {
    try {
        const api = getAPI();
        const logs = await api.GetAllLogs(200);
        globalLogState.logs = logs || [];
        renderGlobalLogs();
    } catch (e) {
        console.error('加载全局日志失败:', e);
        const content = document.getElementById('global-log-content');
        if (content) content.innerHTML = '<div class="empty-state" style="padding:32px"><p class="text-muted">加载失败</p></div>';
    }
}

function renderGlobalLogs() {
    const content = document.getElementById('global-log-content');
    if (!content) return;

    const filtered = filterGlobalLogs(globalLogState.logs);

    // 更新计数
    const countEl = document.getElementById('global-log-count');
    if (countEl) countEl.textContent = `${filtered.length} / ${globalLogState.logs.length} 条`;

    if (filtered.length === 0) {
        content.innerHTML = '<div class="empty-state" style="padding:48px"><p class="text-muted">无匹配的日志</p></div>';
        return;
    }

    // GetAllLogs 返回降序（最新在前），反转为升序显示（最旧在顶，最新在底），符合常规日志查看习惯
    content.innerHTML = filtered.slice().reverse().map(e => renderGlobalLogEntry(e, globalLogState.search)).join('');

    if (globalLogState.autoScroll) {
        content.scrollTop = content.scrollHeight;
    }
}

// 渲染项目筛选下拉
function renderGlobalLogProjectFilter() {
    const sel = document.getElementById('global-log-project');
    if (!sel) return;
    const current = globalLogState.projectId;
    sel.innerHTML = '<option value="">全部项目</option>' +
        state.projects.map(p => `<option value="${esc(p.id)}"${p.id === current ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}

export function renderGlobalLogsView() {
    renderGlobalLogProjectFilter();
    loadGlobalLogs();
}

// 轮询用：全局日志视图刷新
export function refreshLogsForPoll() {
    if (state.currentView === 'project') loadLogs();
    if (state.currentView === 'logs') loadGlobalLogs();
}

// ========== 事件绑定 ==========
export function bindLogEvents() {
    // ── 项目详情日志 ──
    const srcFilter = document.getElementById('log-source-filter');
    if (srcFilter) {
        srcFilter.addEventListener('change', (e) => {
            state.logFilter = e.target.value;
            loadLogs();
        });
    }

    document.querySelectorAll('#log-level-filters .log-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#log-level-filters .log-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.logLevelFilter = btn.getAttribute('data-level');
            loadLogs();
        });
    });

    const clearBtn = document.getElementById('btn-clear-logs');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            const api = getAPI();
            await api.ClearLogs(state.selectedProjectId);
            await loadLogs();
            const { toast } = await import('./core.js');
            toast('日志已清空', 'success');
        });
    }

    // 日志中的链接点击 → 系统浏览器打开
    const logContent = document.getElementById('log-content');
    if (logContent) {
        logContent.addEventListener('click', (e) => {
            const link = e.target.closest('[data-url]');
            if (link) {
                e.preventDefault();
                const url = link.getAttribute('data-url');
                const api = getAPI();
                if (api.OpenURL) api.OpenURL(url).catch(() => {});
            }
        });
    }

    // ── 全局日志视图（Phase 3） ──
    bindGlobalLogEvents();
}

function bindGlobalLogEvents() {
    // 实时搜索（输入即过滤）
    const searchInput = document.getElementById('global-log-search');
    if (searchInput) {
        let debounceTimer = null;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                globalLogState.search = e.target.value;
                renderGlobalLogs();
            }, 200);
        });
    }

    // 级别下拉
    const levelSel = document.getElementById('global-log-level');
    if (levelSel) {
        levelSel.addEventListener('change', (e) => {
            globalLogState.level = e.target.value;
            renderGlobalLogs();
        });
    }

    // 项目下拉
    const projSel = document.getElementById('global-log-project');
    if (projSel) {
        projSel.addEventListener('change', (e) => {
            globalLogState.projectId = e.target.value;
            renderGlobalLogs();
        });
    }

    // 清空全部日志
    const clearAllBtn = document.getElementById('btn-clear-global-logs');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', async () => {
            const { showConfirm } = await import('./core.js');
            const ok = await showConfirm('确定清空所有项目的日志？此操作不可撤销。', '清空全部日志', 'warning');
            if (!ok) return;
            const api = getAPI();
            for (const p of state.projects) {
                try { await api.ClearLogs(p.id); } catch (e) { /* ignore */ }
            }
            await loadGlobalLogs();
            const { toast } = await import('./core.js');
            toast('所有日志已清空', 'success');
        });
    }

    // 滚动检测：上滚暂停，回底恢复
    const content = document.getElementById('global-log-content');
    if (content) {
        content.addEventListener('scroll', () => {
            const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 24;
            const wasAuto = globalLogState.autoScroll;
            globalLogState.autoScroll = atBottom;
            updateScrollHint();
            if (!wasAuto && atBottom) {
                // 用户回到底部，恢复后立即贴底
                content.scrollTop = content.scrollHeight;
            }
        });
    }

    // "回到底部"按钮
    const resumeBtn = document.getElementById('global-log-resume');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            globalLogState.autoScroll = true;
            const c = document.getElementById('global-log-content');
            if (c) c.scrollTop = c.scrollHeight;
            updateScrollHint();
        });
    }
}

function updateScrollHint() {
    const hint = document.getElementById('global-log-scroll-hint');
    if (!hint) return;
    hint.style.display = globalLogState.autoScroll ? 'none' : '';
}
