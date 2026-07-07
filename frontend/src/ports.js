// ========== Sliect Launcher — 端口管理模块（Phase 4） ==========
// 负责：列出被占用端口、按端口/进程名筛选、一键 taskkill 释放

import { esc, toast, showConfirm } from './core.js';
import { getAPI } from './api-bridge.js';

const portsState = {
    ports: [],
    filter: '',
    protocol: '', // '' | 'tcp' | 'udp'
};

// 加载端口列表
export async function loadPorts() {
    const api = getAPI();
    try {
        const list = await api.GetPortList();
        portsState.ports = Array.isArray(list) ? list : [];
    } catch (e) {
        console.error('加载端口列表失败:', e);
        portsState.ports = [];
    }
}

// 渲染端口管理视图
export async function renderPortsView() {
    await loadPorts();
    renderPortList();
    updatePortStats();
}

// 更新统计信息
function updatePortStats() {
    const total = portsState.ports.length;
    const tcpCount = portsState.ports.filter(p => p.protocol === 'tcp').length;
    const udpCount = portsState.ports.filter(p => p.protocol === 'udp').length;
    const procSet = new Set(portsState.ports.map(p => `${p.pid}:${p.processName}`));

    const totalEl = document.getElementById('ports-stats-total');
    const tcpEl = document.getElementById('ports-stats-tcp');
    const udpEl = document.getElementById('ports-stats-udp');
    const procEl = document.getElementById('ports-stats-proc');

    if (totalEl) totalEl.textContent = total;
    if (tcpEl) tcpEl.textContent = tcpCount;
    if (udpEl) udpEl.textContent = udpCount;
    if (procEl) procEl.textContent = procSet.size;
}

// 渲染端口列表
function renderPortList() {
    const container = document.getElementById('ports-list');
    if (!container) return;

    let filtered = portsState.ports;
    if (portsState.protocol) {
        filtered = filtered.filter(p => p.protocol === portsState.protocol);
    }
    if (portsState.filter) {
        const q = portsState.filter.toLowerCase();
        filtered = filtered.filter(p =>
            String(p.port).includes(q) ||
            p.processName.toLowerCase().includes(q) ||
            String(p.pid).includes(q)
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="placeholder-state">
                <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
                <h2 class="placeholder-title">${portsState.filter || portsState.protocol ? '没有匹配的端口' : '未检测到占用端口'}</h2>
                <p class="placeholder-desc">${portsState.filter || portsState.protocol ? '尝试调整筛选条件' : '当前系统没有处于监听状态的端口'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="ports-table">
            <div class="ports-table-header">
                <div class="ports-col-port">端口</div>
                <div class="ports-col-proto">协议</div>
                <div class="ports-col-pid">PID</div>
                <div class="ports-col-name">进程名</div>
                <div class="ports-col-addr">本地地址</div>
                <div class="ports-col-action">操作</div>
            </div>
            ${filtered.map(p => `
                <div class="ports-table-row" data-port="${p.port}">
                    <div class="ports-col-port"><code class="ports-port-code">${p.port}</code></div>
                    <div class="ports-col-proto"><span class="ports-proto-badge ${p.protocol}">${p.protocol.toUpperCase()}</span></div>
                    <div class="ports-col-pid">${p.pid}</div>
                    <div class="ports-col-name" title="${esc(p.processName)}">${esc(p.processName)}</div>
                    <div class="ports-col-addr"><code class="ports-addr-code">${esc(p.localAddr || '0.0.0.0')}</code></div>
                    <div class="ports-col-action">
                        <button class="btn btn-danger-ghost btn-xs btn-kill-port" data-port="${p.port}" data-pid="${p.pid}" data-name="${esc(p.processName)}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            释放
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // 绑定释放按钮
    container.querySelectorAll('.btn-kill-port').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const port = parseInt(btn.dataset.port);
            const pid = parseInt(btn.dataset.pid);
            const name = btn.dataset.name;
            killPort(port, pid, name);
        });
    });
}

// 终止占用端口的进程
async function killPort(port, pid, name) {
    const confirmed = await showConfirm(
        `确定释放端口 <strong>${port}</strong>？<br>这将终止进程「<strong>${esc(name)}</strong>」(PID: ${pid}) 及其所有子进程。`,
        '释放端口',
        'warning'
    );
    if (!confirmed) return;
    const api = getAPI();
    try {
        await api.KillPort(port);
        toast(`端口 ${port} 已释放（已终止 ${name}）`, 'success');
        await loadPorts();
        renderPortList();
        updatePortStats();
    } catch (e) {
        toast('释放端口失败: ' + (e.message || e), 'error');
    }
}

// 刷新端口列表
export async function refreshPorts() {
    await loadPorts();
    renderPortList();
    updatePortStats();
    toast('端口列表已刷新', 'info');
}

// 事件绑定
export function bindPortsEvents() {
    const refreshBtn = document.getElementById('btn-ports-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshPorts);

    const searchInput = document.getElementById('ports-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            portsState.filter = e.target.value;
            renderPortList();
        });
    }

    const protoSelect = document.getElementById('ports-protocol-filter');
    if (protoSelect) {
        protoSelect.addEventListener('change', (e) => {
            portsState.protocol = e.target.value;
            renderPortList();
        });
    }
}

// 轮询钩子：仅刷新统计，不重渲染列表（避免打断用户操作）
export async function refreshPortsForPoll() {
    const view = document.getElementById('view-ports');
    if (!view || !view.classList.contains('active')) return;
    // 端口列表不频繁变动，不每 2s 重拉，仅在前端无操作时刷新
    // 这里采用 5 次轮询刷新一次的节奏
    portsState._pollCount = (portsState._pollCount || 0) + 1;
    if (portsState._pollCount % 5 !== 0) return;
    try {
        await loadPorts();
        updatePortStats();
    } catch (e) { /* ignore */ }
}
