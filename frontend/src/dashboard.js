// ========== Sliect Launcher — 仪表盘模块 ==========
// 负责：统计卡片、CPU/内存环形监控、Top 进程、日志分布、刷新速度控制
// Phase 2：磁盘/网络折线图、历史缓冲、系统信息页

import { state, esc, formatBytes } from './core.js';
import { getAPI } from './api-bridge.js';

let currentRefreshSpeed = 2000;
let dashboardIntervalId = null;
// 外部刷新回调（由 main.js 注入：项目轮询 / 日志 / 终端 / 状态栏）
let pollHooks = [];

export function registerPollHook(fn) { pollHooks.push(fn); }

// ========== 历史缓冲（Phase 2 折线图数据源） ==========
const MAX_HISTORY = 60; // 60 点 = 2 分钟历史（2s 间隔）
const history = {
    cpu: [],
    mem: [],
    diskRead: [],
    diskWrite: [],
    netUp: [],
    netDown: [],
};

function pushHistory(arr, v) {
    arr.push(v);
    if (arr.length > MAX_HISTORY) arr.shift();
}

// ========== 渲染入口 ==========
export function renderDashboard() {
    renderStatCards();
    updateSystemMonitor();
    updateTopProcesses();
    updateLogStats();
}

// ========== 统计卡片 ==========
export function renderStatCards() {
    const total = state.projects.length;
    const running = state.projects.filter(p => p.status === 'running').length;
    const stopped = state.projects.filter(p => p.status === 'stopped' || !p.status).length;
    const crashed = state.projects.filter(p => p.status === 'crashed').length;

    const container = document.getElementById('stat-cards');
    if (!container) return;
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

// ========== SVG 折线图渲染（轻量，无依赖） ==========
// series: [{ data: number[], color: string, fillId: string }]
// options: { max?: number, autoMax?: boolean }
function renderLineChart(containerId, series, options = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const w = 100, h = 40;

    // 计算最大值（百分比图固定 100，速率图自适应）
    let computedMax = options.max || 100;
    if (options.autoMax) {
        computedMax = 1;
        for (const s of series) {
            for (const v of s.data) if (v > computedMax) computedMax = v;
        }
        computedMax = computedMax * 1.25; // 25% 顶部留白
    }

    const step = w / Math.max(MAX_HISTORY - 1, 1);
    const toPoints = (data) => {
        if (data.length === 0) return '';
        return data.map((v, i) => {
            const x = (i * step).toFixed(2);
            const y = (h - (Math.min(v, computedMax) / computedMax) * h).toFixed(2);
            return `${x},${y}`;
        }).join(' ');
    };

    const seriesSvg = series.map(s => {
        const pts = toPoints(s.data);
        if (!pts) return '';
        const lastX = ((s.data.length - 1) * step).toFixed(2);
        const fillPath = `M0,${h} L${pts.replace(/ /g, ' L')} L${lastX},${h} Z`;
        return `
            <path d="${fillPath}" fill="url(#${s.fillId})"/>
            <polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="1.5"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        `;
    }).join('');

    const defs = series.map(s => `
        <linearGradient id="${s.fillId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${s.color}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/>
        </linearGradient>
    `).join('');

    el.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart-svg">
            <defs>${defs}</defs>
            ${seriesSvg}
        </svg>
    `;
}

// ========== 系统监控环形图 + 折线图 ==========
export async function updateSystemMonitor() {
    try {
        const api = getAPI();
        // Phase 2：改用 GetFullSystemStats 一次拿全数据
        const s = await api.GetFullSystemStats();
        const cpuPct = s.cpuPercent || 0;
        const memPct = s.memPercent || 0;
        const circumference = 238.76;

        // 环形图（CSS transition 自动平滑过渡）
        const cpuRing = document.getElementById('cpu-ring');
        const memRing = document.getElementById('mem-ring');
        if (cpuRing) cpuRing.style.strokeDashoffset = circumference * (1 - cpuPct / 100);
        if (memRing) memRing.style.strokeDashoffset = circumference * (1 - memPct / 100);

        const cpuVal = document.getElementById('cpu-value');
        const memVal = document.getElementById('mem-value');
        if (cpuVal) cpuVal.textContent = cpuPct.toFixed(1) + '%';
        if (memVal) memVal.textContent = memPct.toFixed(1) + '%';
        const coresLabel = document.getElementById('cpu-cores-label');
        if (coresLabel) coresLabel.textContent = `${s.cpuCores} 核处理器`;
        const memLabel = document.getElementById('mem-detail-label');
        if (memLabel) memLabel.textContent = `${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal)}`;

        // 推入历史缓冲
        pushHistory(history.cpu, cpuPct);
        pushHistory(history.mem, memPct);

        // 磁盘 IO 汇总（所有物理盘求和）
        let diskRead = 0, diskWrite = 0;
        for (const d of (s.diskIO || [])) {
            diskRead += d.readBytesPerSec || 0;
            diskWrite += d.writeBytesPerSec || 0;
        }
        pushHistory(history.diskRead, diskRead);
        pushHistory(history.diskWrite, diskWrite);

        // 网络 IO 汇总（所有非回环网卡求和）
        let netUp = 0, netDown = 0;
        for (const n of (s.netIO || [])) {
            netUp += n.bytesSentPerSec || 0;
            netDown += n.bytesRecvPerSec || 0;
        }
        pushHistory(history.netUp, netUp);
        pushHistory(history.netDown, netDown);

        // 渲染折线图
        const css = getComputedStyle(document.documentElement);
        const cCpu = css.getPropertyValue('--primary').trim() || '#565DF0';
        const cMem = css.getPropertyValue('--accent').trim() || '#0F9D58';
        const cDiskR = css.getPropertyValue('--primary').trim() || '#565DF0';
        const cDiskW = css.getPropertyValue('--warning').trim() || '#F59E0B';
        const cNetU = css.getPropertyValue('--success').trim() || '#22C55E';
        const cNetD = css.getPropertyValue('--primary').trim() || '#565DF0';

        renderLineChart('chart-cpu', [{ data: history.cpu, color: cCpu, fillId: 'fill-cpu' }], { max: 100 });
        renderLineChart('chart-mem', [{ data: history.mem, color: cMem, fillId: 'fill-mem' }], { max: 100 });
        renderLineChart('chart-disk', [
            { data: history.diskRead, color: cDiskR, fillId: 'fill-disk-r' },
            { data: history.diskWrite, color: cDiskW, fillId: 'fill-disk-w' },
        ], { autoMax: true });
        renderLineChart('chart-net', [
            { data: history.netUp, color: cNetU, fillId: 'fill-net-u' },
            { data: history.netDown, color: cNetD, fillId: 'fill-net-d' },
        ], { autoMax: true });

        // 当前值标签
        const chartCpuCur = document.getElementById('chart-cpu-current');
        if (chartCpuCur) chartCpuCur.textContent = cpuPct.toFixed(1) + '%';
        const chartMemCur = document.getElementById('chart-mem-current');
        if (chartMemCur) chartMemCur.textContent = memPct.toFixed(1) + '%';
        const chartDiskCur = document.getElementById('chart-disk-current');
        if (chartDiskCur) chartDiskCur.textContent = `${formatBytes(diskRead)}/s · ${formatBytes(diskWrite)}/s`;
        const chartNetCur = document.getElementById('chart-net-current');
        if (chartNetCur) chartNetCur.textContent = `↑${formatBytes(netUp)}/s ↓${formatBytes(netDown)}/s`;
    } catch (e) { /* ignore */ }
}

// ========== 系统信息页（Phase 2） ==========
export async function renderSysinfo() {
    try {
        const api = getAPI();
        const s = await api.GetFullSystemStats();

        // 磁盘分区列表
        const diskList = document.getElementById('sysinfo-disk-list');
        if (diskList) {
            diskList.innerHTML = (s.disks || []).map(d => {
                const pct = d.usedPercent || 0;
                const barClass = pct > 90 ? 'danger' : pct > 75 ? 'warning' : 'success';
                return `
                    <div class="sysinfo-disk-row">
                        <div class="sysinfo-disk-info">
                            <span class="sysinfo-disk-path">${esc(d.path)}</span>
                            <span class="sysinfo-disk-device">${esc(d.device)} · ${esc(d.fstype || '')}</span>
                        </div>
                        <div class="sysinfo-disk-bar-wrap">
                            <div class="sysinfo-disk-bar ${barClass}" style="width:${pct.toFixed(1)}%"></div>
                        </div>
                        <div class="sysinfo-disk-numbers">
                            <span class="sysinfo-disk-pct">${pct.toFixed(1)}%</span>
                            <span class="sysinfo-disk-detail">${formatBytes(d.used)} / ${formatBytes(d.total)}</span>
                            <span class="sysinfo-disk-free">可用 ${formatBytes(d.free)}</span>
                        </div>
                    </div>
                `;
            }).join('') || '<div class="sysinfo-empty">无磁盘数据</div>';
        }

        // 磁盘 IO 速率
        const diskIOList = document.getElementById('sysinfo-diskio-list');
        if (diskIOList) {
            diskIOList.innerHTML = (s.diskIO || []).map(d => `
                <div class="sysinfo-io-card">
                    <div class="sysinfo-io-name">${esc(d.name)}</div>
                    <div class="sysinfo-io-row">
                        <span class="sysinfo-io-label read">读取</span>
                        <span class="sysinfo-io-value">${formatBytes(d.readBytesPerSec || 0)}/s</span>
                    </div>
                    <div class="sysinfo-io-row">
                        <span class="sysinfo-io-label write">写入</span>
                        <span class="sysinfo-io-value">${formatBytes(d.writeBytesPerSec || 0)}/s</span>
                    </div>
                    <div class="sysinfo-io-total">
                        累计 读 ${formatBytes(d.readBytes)} · 写 ${formatBytes(d.writeBytes)}
                    </div>
                </div>
            `).join('') || '<div class="sysinfo-empty">无磁盘 IO 数据</div>';
        }

        // 网络接口
        const netIOList = document.getElementById('sysinfo-netio-list');
        if (netIOList) {
            netIOList.innerHTML = (s.netIO || []).map(n => `
                <div class="sysinfo-io-card">
                    <div class="sysinfo-io-name">${esc(n.name)}</div>
                    <div class="sysinfo-io-row">
                        <span class="sysinfo-io-label up">上行</span>
                        <span class="sysinfo-io-value">${formatBytes(n.bytesSentPerSec || 0)}/s</span>
                    </div>
                    <div class="sysinfo-io-row">
                        <span class="sysinfo-io-label down">下行</span>
                        <span class="sysinfo-io-value">${formatBytes(n.bytesRecvPerSec || 0)}/s</span>
                    </div>
                    <div class="sysinfo-io-total">
                        累计 ↑${formatBytes(n.bytesSent)} · ↓${formatBytes(n.bytesRecv)}
                    </div>
                    <div class="sysinfo-io-total">包 ↑${n.packetsSent || 0} · ↓${n.packetsRecv || 0}</div>
                </div>
            `).join('') || '<div class="sysinfo-empty">无网络接口数据</div>';
        }
    } catch (e) { /* ignore */ }
}

// ========== Top 进程 ==========
export async function updateTopProcesses() {
    try {
        const api = getAPI();
        const tp = await api.GetTopProcesses();
        const cpuList = document.getElementById('top-cpu-list');
        const memList = document.getElementById('top-mem-list');
        if (!cpuList || !memList) return;

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

// ========== 日志分布 ==========
export async function updateLogStats() {
    try {
        const api = getAPI();
        const s = await api.GetLogStats();
        const el = document.getElementById('log-stats-chips');
        if (!el) return;
        el.innerHTML = `
            <span class="log-chip error"><span class="log-chip-count">${s.error || 0}</span> ERROR</span>
            <span class="log-chip warn"><span class="log-chip-count">${s.warn || 0}</span> WARN</span>
            <span class="log-chip info"><span class="log-chip-count">${s.info || 0}</span> INFO</span>
            <span class="log-chip debug"><span class="log-chip-count">${s.debug || 0}</span> DEBUG</span>
        `;
    } catch (e) { /* ignore */ }
}

// ========== 仪表盘专属轮询刷新 ==========
export function refreshDashboardForPoll() {
    if (state.currentView !== 'dashboard') return;
    updateSystemMonitor();
    updateTopProcesses();
    updateLogStats();
}

// 系统信息页轮询刷新
export function refreshSysinfoForPoll() {
    if (state.currentView !== 'sysinfo') return;
    renderSysinfo();
}

// ========== 刷新速度控制 ==========
export function bindDashboardEvents() {
    const opts = document.getElementById('refresh-speed-options');
    if (opts) {
        opts.addEventListener('click', (e) => {
            const btn = e.target.closest('.refresh-speed-btn');
            if (!btn) return;
            const speed = parseInt(btn.dataset.speed, 10);
            if (isNaN(speed)) return;
            document.querySelectorAll('.refresh-speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            startDashboardPolling(speed);
        });
    }

    // 系统信息页刷新按钮
    const sysinfoRefresh = document.getElementById('btn-sysinfo-refresh');
    if (sysinfoRefresh) {
        sysinfoRefresh.addEventListener('click', () => renderSysinfo());
    }
}

// ========== 统一轮询（项目状态 + 仪表盘 + 日志 + 终端 + 状态栏） ==========
export function startDashboardPolling(speed) {
    if (dashboardIntervalId) clearInterval(dashboardIntervalId);
    currentRefreshSpeed = speed || currentRefreshSpeed;
    dashboardIntervalId = setInterval(async () => {
        for (const fn of pollHooks) {
            try { await fn(); } catch (e) { /* ignore single hook failure */ }
        }
    }, currentRefreshSpeed);
}

export function startPolling() {
    startDashboardPolling(2000);
}
