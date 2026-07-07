// ========== Sliect Launcher — 终端模块 ==========
// 负责：终端面板切换、终端输出刷新、命令输入栏发送

import { state, esc } from './core.js';
import { getAPI } from './api-bridge.js';
import { loadLogs } from './logviewer.js';

// 更新终端输出（从日志中提取 stdout/stderr/stdin 内容）
export async function updateTerminalOutput() {
    if (!state.selectedProjectId) return;
    const termOutput = document.getElementById('terminal-output');
    if (!termOutput) return;

    try {
        const api = getAPI();
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
export function appendTermLine(text, className) {
    const termOutput = document.getElementById('terminal-output');
    if (!termOutput) return;
    const div = document.createElement('div');
    div.className = 'term-line' + (className ? ' ' + className : '');
    div.textContent = text;
    termOutput.appendChild(div);
    termOutput.scrollTop = termOutput.scrollHeight;
}

export function bindTerminalEvents() {
    const termPanel = document.getElementById('terminal-panel');
    const termInput = document.getElementById('terminal-input');
    const termBtn = document.getElementById('btn-toggle-terminal');
    if (!termPanel || !termBtn) return;
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

            appendTermLine(cmd, 'cmd');
            termInput.value = '';

            try {
                const api = getAPI();
                await api.SendCommand(pid, cmd);
            } catch (err) {
                appendTermLine('发送失败: ' + err, 'err');
            }
            setTimeout(() => updateTerminalOutput(), 200);
        }
    });

    // 命令输入栏（日志下方）
    const cmdInput = document.getElementById('log-command-input');
    const cmdSendBtn = document.getElementById('btn-send-command');

    async function sendCommandToProject() {
        const cmd = cmdInput.value.trim();
        if (!cmd) return;
        const pid = state.selectedProjectId;
        if (!pid) return;
        try {
            const api = getAPI();
            const err = await api.SendCommand(pid, cmd);
            if (err) console.error('[SendCommand] 发送失败:', err);
            cmdInput.value = '';
            setTimeout(() => loadLogs(), 100);
        } catch (e) {
            console.error('[SendCommand] 异常:', e);
        }
    }

    if (cmdInput) {
        cmdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendCommandToProject();
            }
        });
    }
    if (cmdSendBtn) {
        cmdSendBtn.addEventListener('click', () => sendCommandToProject());
    }
}

// 轮询用：项目视图 + 终端已开启时刷新终端输出
export function refreshTerminalForPoll() {
    if (state.currentView !== 'project') return;
    const lp = document.querySelector('.log-panel');
    if (lp && lp.classList.contains('terminal-active')) {
        updateTerminalOutput();
    }
}
