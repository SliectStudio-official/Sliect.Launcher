// ========== Sliect Launcher — 设置模块 ==========
// 负责：设置页渲染、主题切换、系统/高级设置即时保存、端口检测工具

import {
    state, esc, toast, applyTheme, showConfirm,
    getCurrentSavedTheme, setCurrentSavedTheme,
} from './core.js';
import { getAPI } from './api-bridge.js';

// 即时保存设置（不弹 toast，静默保存）
export async function saveSettingsNow(themeOverride) {
    const theme = themeOverride || getCurrentSavedTheme() || 'light';
    const minimize = document.getElementById('setting-minimize-tray')?.checked ?? true;
    const startBoot = document.getElementById('setting-start-boot')?.checked ?? false;
    const autoRestart = document.getElementById('setting-auto-restart')?.checked ?? false;
    const maxRestart = parseInt(document.getElementById('setting-max-restart')?.value, 10) || 5;
    try {
        const api = getAPI();
        await api.UpdateGlobalSettings(theme, minimize, startBoot, autoRestart, maxRestart);
    } catch (e) { /* ignore */ }
}

export async function renderSettings() {
    try {
        const api = getAPI();
        const s = await api.GetGlobalSettings();
        const theme = s.theme || 'light';
        setCurrentSavedTheme(theme);
        applyTheme(theme);
        document.querySelectorAll('.theme-option').forEach(opt => {
            opt.classList.toggle('active', opt.id === 'theme-' + theme);
        });
        document.getElementById('setting-minimize-tray').checked = s.minimizeToTray;
        document.getElementById('setting-start-boot').checked = s.startOnBoot;
        document.getElementById('setting-auto-restart').checked = s.autoRestartGlobal;
        document.getElementById('setting-max-restart').value = s.globalMaxRestartCount || 5;

        // 动态获取版本号
        try {
            const ver = await api.GetVersion();
            const verEl = document.getElementById('app-version');
            if (verEl) verEl.textContent = ver;
        } catch (_) {}
    } catch (e) {
        console.error('加载设置失败:', e);
    }
}

export function bindSettingsEvents() {
    // 主题切换 — 即时应用并保存
    function setTheme(theme) {
        setCurrentSavedTheme(theme);
        document.body.classList.add('theme-transitioning');
        applyTheme(theme);
        document.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('active'));
        const btn = document.getElementById('theme-' + theme);
        if (btn) btn.classList.add('active');
        saveSettingsNow(theme);
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

    // ═══════════ Phase 6：配置备份恢复 ═══════════
    document.getElementById('btn-export-config')?.addEventListener('click', exportConfig);
    document.getElementById('btn-import-config')?.addEventListener('click', () => {
        document.getElementById('import-config-file')?.click();
    });
    document.getElementById('import-config-file')?.addEventListener('change', importConfig);

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
        const api = getAPI();
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
                    const { showConfirm } = await import('./core.js');
                    const confirmed = await showConfirm(`确定要终止 PID ${pid} 的进程吗？`, '结束进程', 'warning');
                    if (!confirmed) return;
                    try {
                        await api.KillProcessByPID(pid);
                        toast('进程已终止', 'info');
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
}

// ========== Phase 6：配置备份恢复 ==========

// 导出配置为 YAML 文件下载
export async function exportConfig() {
    const api = getAPI();
    const btn = document.getElementById('btn-export-config');
    try {
        btn.disabled = true;
        const yaml = await api.ExportConfig();
        // 创建 Blob 并触发下载
        const blob = new Blob([yaml], { type: 'text/yaml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `sliect-launcher-config-${ts}.yaml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('配置已导出', 'success');
    } catch (e) {
        toast('导出失败: ' + (e.message || e), 'error');
    } finally {
        btn.disabled = false;
    }
}

// 从文件导入配置
export async function importConfig(e) {
    const file = e.target.files[0];
    if (!file) return;

    const confirmed = await showConfirm(
        `确定要导入文件「${file.name}」吗？\n当前配置将被替换（运行中的进程不受影响）。`,
        '导入配置',
        'warning'
    );
    if (!confirmed) {
        e.target.value = ''; // 重置 input 以便重复选择同一文件
        return;
    }

    const api = getAPI();
    try {
        const text = await file.text();
        await api.ImportConfig(text);
        toast('配置已导入，正在刷新...', 'success');
        // 刷新设置页和项目列表
        await renderSettings();
        // 触发项目列表刷新
        const { refreshData } = await import('./projects.js');
        await refreshData();
    } catch (err) {
        toast('导入失败: ' + (err.message || err), 'error');
    } finally {
        e.target.value = ''; // 重置 input
    }
}
