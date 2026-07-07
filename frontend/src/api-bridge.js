// ========== Sliect Launcher — API 桥接层 ==========
// 统一封装 Wails 绑定调用：生产环境使用 wailsjs 生成代码，开发模式使用 mock
// 所有功能模块通过此模块访问后端，不直接 import wailsjs

let api = null;
let wailsRuntime = null;

// 初始化 API：尝试加载 Wails 绑定，失败则降级为 mock
export async function initAPI() {
    try {
        const app = await import('../wailsjs/go/main/App.js');
        const rt = await import('../wailsjs/runtime/runtime.js');
        api = {
            // 项目管理
            GetProjects: () => app.GetProjects(),
            GetProject: (id) => app.GetProject(id),
            AddProject: (input) => app.AddProject(input),
            UpdateProject: (input) => app.UpdateProject(input),
            DeleteProject: (id) => app.DeleteProject(id),
            // 进程控制
            StartProject: (id) => app.StartProject(id),
            StopProject: (id) => app.StopProject(id),
            ForceStopProject: (id) => app.ForceStopProject(id),
            RestartProject: (id) => app.RestartProject(id),
            SendCommand: (projectId, cmd) => app.SendCommand(projectId, cmd),
            // 分组
            GetGroups: () => app.GetGroups(),
            AddGroup: (input) => app.AddGroup(input),
            UpdateGroup: (input) => app.UpdateGroup(input),
            DeleteGroup: (id) => app.DeleteGroup(id),
            StartGroup: (gid) => app.StartGroup(gid),
            StopGroup: (gid) => app.StopGroup(gid),
            // 日志
            GetLogs: (pid, n) => app.GetLogs(pid, n),
            GetAllLogs: (n) => app.GetAllLogs(n),
            ClearLogs: (pid) => app.ClearLogs(pid),
            // 进程状态
            GetProcessInfo: (pid) => app.GetProcessInfo(pid),
            GetAllProcessInfo: () => app.GetAllProcessInfo(),
            // 全局设置
            GetGlobalSettings: () => app.GetGlobalSettings(),
            UpdateGlobalSettings: (t, m, s, a, r) => app.UpdateGlobalSettings(t, m, s, a, r),
            // 系统对话框
            SelectExecutable: () => app.SelectExecutable(),
            SelectFolder: (title) => app.SelectFolder(title),
            SelectFile: (title, filters) => app.SelectFile(title, filters),
            // 系统监控
            GetSystemStats: () => app.GetSystemStats(),
            GetTopProcesses: () => app.GetTopProcesses(),
            GetLogStats: () => app.GetLogStats(),
            GetDebugInfo: (pid) => app.GetDebugInfo(pid),
            // Phase 2 新增：磁盘 / 网络 IO 采集
            GetFullSystemStats: () => app.GetFullSystemStats(),
            GetDiskUsage: () => app.GetDiskUsage(),
            GetDiskIOStats: () => app.GetDiskIOStats(),
            GetNetIOStats: () => app.GetNetIOStats(),
            // Phase 4 新增：计划任务
            GetTasks: () => app.GetTasks(),
            AddTask: (input) => app.AddTask(input),
            UpdateTask: (input) => app.UpdateTask(input),
            DeleteTask: (id) => app.DeleteTask(id),
            GetTaskLogs: (taskId) => app.GetTaskLogs(taskId),
            RunTaskNow: (id) => app.RunTaskNow(id),
            // Phase 4 新增：端口管理
            GetPortList: () => app.GetPortList(),
            KillPort: (port) => app.KillPort(port),
            // Phase 5 新增：文件浏览（只读）
            ListDir: (path) => app.ListDir(path),
            GetDirTree: (root, maxDepth) => app.GetDirTree(root, maxDepth),
            // Phase 5 新增：启动项排序
            ReorderAutoStartProjects: (orderedIDs) => app.ReorderAutoStartProjects(orderedIDs),
            // Phase 6 新增：配置备份恢复
            ExportConfig: () => app.ExportConfig(),
            ImportConfig: (yamlContent) => app.ImportConfig(yamlContent),
            // 其他
            OpenURL: (url) => app.OpenURL(url),
            CheckPortInUse: (port) => app.CheckPortInUse(port),
            KillProcessByPID: (pid) => app.KillProcessByPID(pid),
            GetVersion: () => app.GetVersion(),
            // 窗口控制
            WindowMinimise: () => app.WindowMinimise(),
            WindowMaximise: () => app.WindowMaximise(),
            WindowUnmaximise: () => app.WindowUnmaximise(),
            WindowClose: () => app.WindowClose(),
            StartWindowDrag: () => app.StartWindowDrag(),
            WindowSetPosition: (x, y) => app.WindowSetPosition(x, y),
            WindowGetPosition: () => app.WindowGetPosition(),
        };
        wailsRuntime = rt;
        console.log('[API] Wails 绑定已加载');
    } catch (e) {
        console.log('[API] 开发模式：使用模拟数据', e);
        api = createMockAPI();
    }
}

export function getAPI() { return api; }
export function getWailsRuntime() { return wailsRuntime; }

// ========== 模拟 API（开发模式） ==========
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
    let tasks = [
        { id: 'backup-db', name: '每日数据库备份', cronExpr: '0 3 * * *', projectId: 'su-backend', timeout: 300, enabled: true, sortOrder: 0, lastStatus: 'success', lastRunAt: Date.now() - 3600000, lastDuration: 45200 },
        { id: 'clean-logs', name: '清理日志文件', cronExpr: '*/30 * * * *', projectId: 'nginx-proxy', timeout: 60, enabled: false, sortOrder: 1, lastStatus: 'failed', lastRunAt: Date.now() - 7200000, lastDuration: 50200 },
    ];
    let taskLogs = {
        'backup-db': [
            { taskId: 'backup-db', startedAt: Date.now() - 3600000, endedAt: Date.now() - 3554800, status: 'success', message: '已启动项目「速办通后端」(PID: 12345)', duration: 45200 },
            { taskId: 'backup-db', startedAt: Date.now() - 122400000, endedAt: Date.now() - 122355000, status: 'success', message: '已启动项目「速办通后端」(PID: 12300)', duration: 45000 },
            { taskId: 'backup-db', startedAt: Date.now() - 208800000, endedAt: Date.now() - 208748000, status: 'failed', message: '启动失败: 项目 su-backend 已在运行中', duration: 200 },
        ],
        'clean-logs': [
            { taskId: 'clean-logs', startedAt: Date.now() - 7200000, endedAt: Date.now() - 7149800, status: 'failed', message: '进程启动后未保持运行（状态: crashed）', duration: 50200 },
        ],
    };
    let ports = [
        { port: 80, protocol: 'tcp', status: 'LISTEN', pid: 2048, processName: 'nginx.exe', localAddr: '0.0.0.0' },
        { port: 443, protocol: 'tcp', status: 'LISTEN', pid: 2048, processName: 'nginx.exe', localAddr: '0.0.0.0' },
        { port: 3000, protocol: 'tcp', status: 'LISTEN', pid: 12345, processName: 'node.exe', localAddr: '127.0.0.1' },
        { port: 3306, protocol: 'tcp', status: 'LISTEN', pid: 4096, processName: 'mysqld.exe', localAddr: '127.0.0.1' },
        { port: 8080, protocol: 'tcp', status: 'LISTEN', pid: 12345, processName: 'node.exe', localAddr: '0.0.0.0' },
        { port: 8081, protocol: 'tcp', status: 'LISTEN', pid: 13201, processName: 'main.exe', localAddr: '0.0.0.0' },
        { port: 135, protocol: 'tcp', status: 'LISTEN', pid: 912, processName: 'svchost.exe', localAddr: '0.0.0.0' },
        { port: 3389, protocol: 'tcp', status: 'LISTEN', pid: 1216, processName: 'TermService.exe', localAddr: '0.0.0.0' },
    ];

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
                    { timestamp: Date.now() - 60000, level: 'info', source: 'system', text: `${pid} 进程已启动` },
                    { timestamp: Date.now() - 55000, level: 'info', source: 'stdout', text: 'Loading configuration...' },
                    { timestamp: Date.now() - 50000, level: 'info', source: 'stdout', text: 'Server started on port 8080' },
                    { timestamp: Date.now() - 30000, level: 'warn', source: 'stdout', text: 'High memory usage detected' },
                    { timestamp: Date.now() - 10000, level: 'debug', source: 'stdout', text: 'Processing request batch #142' },
                ];
            }
            return (logs[pid] || []).slice(-200);
        },
        ClearLogs: async (pid) => { logs[pid] = []; },
        GetAllLogs: async (n) => {
            // 聚合所有项目的 mock 日志，带 projectName
            const all = [];
            for (const p of projects) {
                const pl = logs[p.id] || [];
                for (const l of pl) {
                    all.push({ ...l, projectName: p.name, projectId: p.id });
                }
            }
            all.sort((a, b) => b.timestamp - a.timestamp);
            return all.slice(0, (n || 100) * 5);
        },
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
        GetVersion: async () => '2.0.260708.0522',
        GetSystemStats: async () => ({ cpuPercent: +(Math.random() * 60 + 10).toFixed(1), cpuCores: 16, memTotal: 34359738368, memUsed: 20615843021, memPercent: 60.0, swapTotal: 8589934592, swapUsed: 2147483648, swapPercent: 25.0 }),
        GetTopProcesses: async () => ({
            byCpu: [{ pid: 1234, name: 'chrome.exe', cpuPercent: 28.5, memMB: 1200, memPercent: 3.5 }, { pid: 5678, name: 'node.exe', cpuPercent: 15.2, memMB: 450, memPercent: 1.3 }, { pid: 9012, name: 'Code.exe', cpuPercent: 8.7, memMB: 800, memPercent: 2.3 }, { pid: 3456, name: 'python.exe', cpuPercent: 5.1, memMB: 200, memPercent: 0.6 }, { pid: 7890, name: 'go.exe', cpuPercent: 2.3, memMB: 50, memPercent: 0.1 }],
            byMem: [{ pid: 1234, name: 'chrome.exe', cpuPercent: 28.5, memMB: 1200, memPercent: 3.5 }, { pid: 9012, name: 'Code.exe', cpuPercent: 8.7, memMB: 800, memPercent: 2.3 }, { pid: 5678, name: 'node.exe', cpuPercent: 15.2, memMB: 450, memPercent: 1.3 }, { pid: 3456, name: 'python.exe', cpuPercent: 5.1, memMB: 200, memPercent: 0.6 }, { pid: 7890, name: 'go.exe', cpuPercent: 2.3, memMB: 50, memPercent: 0.1 }]
        }),
        GetLogStats: async () => ({ error: 3, warn: 12, info: 156, debug: 42, trace: 0 }),
        GetDebugInfo: async (pid) => ({ projectId: pid, inMap: false, bufferCount: 0 }),
        // Phase 2 mock：磁盘 / 网络
        GetFullSystemStats: async () => ({
            cpuPercent: +(Math.random() * 60 + 10).toFixed(1), cpuCores: 16,
            memTotal: 34359738368, memUsed: 20615843021, memPercent: 60.0,
            swapTotal: 8589934592, swapUsed: 2147483648, swapPercent: 25.0,
            disks: [
                { path: 'C:\\', device: 'C:', fstype: 'NTFS', total: 512110190592, used: 322122547200, free: 189987643392, usedPercent: 62.9 },
                { path: 'D:\\', device: 'D:', fstype: 'NTFS', total: 1073741824000, used: 536870912000, free: 536870912000, usedPercent: 50.0 },
            ],
            diskIO: [
                { name: 'PhysicalDrive0', readBytes: 1024, writeBytes: 2048, readBytesPerSec: +(Math.random() * 1048576).toFixed(0), writeBytesPerSec: +(Math.random() * 2097152).toFixed(0) },
            ],
            netIO: [
                { name: '以太网', bytesSent: 1048576, bytesRecv: 8388608, bytesSentPerSec: +(Math.random() * 102400).toFixed(0), bytesRecvPerSec: +(Math.random() * 524288).toFixed(0), packetsSent: 1024, packetsRecv: 8192 },
                { name: 'Wi-Fi', bytesSent: 524288, bytesRecv: 4194304, bytesSentPerSec: +(Math.random() * 51200).toFixed(0), bytesRecvPerSec: +(Math.random() * 262144).toFixed(0), packetsSent: 512, packetsRecv: 4096 },
            ],
        }),
        GetDiskUsage: async () => ([
            { path: 'C:\\', device: 'C:', fstype: 'NTFS', total: 512110190592, used: 322122547200, free: 189987643392, usedPercent: 62.9 },
            { path: 'D:\\', device: 'D:', fstype: 'NTFS', total: 1073741824000, used: 536870912000, free: 536870912000, usedPercent: 50.0 },
        ]),
        GetDiskIOStats: async () => ([
            { name: 'PhysicalDrive0', readBytes: 1024, writeBytes: 2048, readBytesPerSec: +(Math.random() * 1048576).toFixed(0), writeBytesPerSec: +(Math.random() * 2097152).toFixed(0) },
        ]),
        GetNetIOStats: async () => ([
            { name: '以太网', bytesSent: 1048576, bytesRecv: 8388608, bytesSentPerSec: +(Math.random() * 102400).toFixed(0), bytesRecvPerSec: +(Math.random() * 524288).toFixed(0), packetsSent: 1024, packetsRecv: 8192 },
            { name: 'Wi-Fi', bytesSent: 524288, bytesRecv: 4194304, bytesSentPerSec: +(Math.random() * 51200).toFixed(0), bytesRecvPerSec: +(Math.random() * 262144).toFixed(0), packetsSent: 512, packetsRecv: 4096 },
        ]),
        WindowMinimise: async () => { console.log('Mock: minimise'); },
        WindowMaximise: async () => { console.log('Mock: maximise'); },
        WindowUnmaximise: async () => { console.log('Mock: unmaximise'); },
        WindowClose: async () => { console.log('Mock: close'); },
        StartWindowDrag: async () => { console.log('Mock: start window drag'); },
        WindowSetPosition: async (x, y) => { console.log('Mock: set position', x, y); },
        WindowGetPosition: async () => ({ X: 100, Y: 100 }),
        SendCommand: async (projectId, cmd) => { console.log('Mock: send command to', projectId, ':', cmd); return null; },
        // Phase 4 mock：计划任务
        GetTasks: async () => [...tasks],
        AddTask: async (input) => {
            const t = { ...input, sortOrder: tasks.length, lastStatus: '', lastRunAt: 0, lastDuration: 0 };
            tasks.push(t);
        },
        UpdateTask: async (input) => {
            const i = tasks.findIndex(t => t.id === input.id);
            if (i >= 0) tasks[i] = { ...tasks[i], ...input };
        },
        DeleteTask: async (id) => {
            tasks = tasks.filter(t => t.id !== id);
            delete taskLogs[id];
        },
        GetTaskLogs: async (taskId) => [...(taskLogs[taskId] || [])],
        RunTaskNow: async (id) => {
            const t = tasks.find(x => x.id === id);
            if (!t) return;
            const start = Date.now();
            const p = projects.find(x => x.id === t.projectId);
            const log = { taskId: id, startedAt: start, endedAt: start + 45000, status: 'success', message: `已启动项目「${p?.name || id}」(PID: ${Math.floor(Math.random() * 90000) + 10000})`, duration: 45000 };
            taskLogs[id] = taskLogs[id] || [];
            taskLogs[id].push(log);
            if (taskLogs[id].length > 50) taskLogs[id] = taskLogs[id].slice(-50);
            t.lastStatus = 'success';
            t.lastRunAt = start;
            t.lastDuration = 45000;
        },
        // Phase 4 mock：端口管理
        GetPortList: async () => [...ports],
        KillPort: async (port) => {
            const p = ports.find(x => x.port === port);
            if (!p) throw new Error(`端口 ${port} 未被占用`);
            ports = ports.filter(x => x.port !== port);
        },
        // Phase 5 mock：文件浏览（只读）
        ListDir: async (path) => {
            if (!path) {
                return [
                    { name: 'C:', path: 'C:\\', isDir: true, size: 0, modTime: 0 },
                    { name: 'D:', path: 'D:\\', isDir: true, size: 0, modTime: 0 },
                    { name: 'E:', path: 'E:\\', isDir: true, size: 0, modTime: 0 },
                ];
            }
            // 模拟几个常见目录
            const mockDirs = {
                'C:\\': [
                    { name: 'nginx', path: 'C:\\nginx', isDir: true, size: 0, modTime: Date.now() - 86400000 },
                    { name: 'Users', path: 'C:\\Users', isDir: true, size: 0, modTime: Date.now() - 172800000 },
                    { name: 'Windows', path: 'C:\\Windows', isDir: true, size: 0, modTime: Date.now() - 259200000 },
                    { name: 'pagefile.sys', path: 'C:\\pagefile.sys', isDir: false, size: 8589934592, modTime: Date.now() - 86400000 },
                ],
                'E:\\': [
                    { name: 'Projects', path: 'E:\\Projects', isDir: true, size: 0, modTime: Date.now() - 3600000 },
                    { name: 'su.sliect.cn', path: 'E:\\su.sliect.cn', isDir: true, size: 0, modTime: Date.now() - 7200000 },
                ],
                'E:\\Projects': [
                    { name: 'api-gateway', path: 'E:\\Projects\\api-gateway', isDir: true, size: 0, modTime: Date.now() - 1800000 },
                    { name: 'Sliect.Launcher', path: 'E:\\Sliect.Launcher', isDir: true, size: 0, modTime: Date.now() - 600000 },
                    { name: 'README.md', path: 'E:\\Projects\\README.md', isDir: false, size: 4096, modTime: Date.now() - 86400000 },
                ],
            };
            return mockDirs[path] || [];
        },
        GetDirTree: async (root, maxDepth) => {
            // 简化 mock：只返回根 + 一层子目录
            const rootName = root.split(/[\\/]/).filter(Boolean).pop() || root;
            return {
                name: rootName,
                path: root,
                children: [
                    { name: 'src', path: root + '\\src', children: [] },
                    { name: 'docs', path: root + '\\docs', children: [] },
                ],
            };
        },
        // Phase 5 mock：启动项排序
        ReorderAutoStartProjects: async (orderedIDs) => {
            const autoProjects = projects.filter(p => p.autoStart);
            orderedIDs.forEach((id, i) => {
                const p = projects.find(x => x.id === id);
                if (p && p.autoStart) p.sortOrder = i;
            });
        },
        // Phase 6 mock：配置备份恢复
        ExportConfig: async () => {
            // 返回简化 YAML
            return `version: 1\ntheme: ${settings.theme}\nprojects:\n${projects.map(p => `  - id: ${p.id}\n    name: ${p.name}`).join('\n')}\n`;
        },
        ImportConfig: async (yamlContent) => {
            console.log('Mock: import config', yamlContent.substring(0, 100) + '...');
        },
    };
}
