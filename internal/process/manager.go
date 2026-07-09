package process

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unicode/utf8"

	"SliectLauncher/internal/config"
	"SliectLauncher/internal/model"

	netos "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// LogCallback 日志回调函数类型（用于推送日志到前端）
type LogCallback func(entry model.LogEntry)

// Manager 进程管理器，管理所有被管项目的生命周期
type Manager struct {
	mu                  sync.RWMutex
	cfg                 *config.Manager
	processes           map[string]*managedProcess
	logBuf              *LogBuffer
	appCtx              atomic.Value                                // 存储 context.Context，无锁读取避免重入死锁
	lastLogTime         map[string]time.Time                        // 每个项目最后一条日志的时间
	OnStopTimeout       func(projectID string)                      // 停止超时且无日志活动时的回调
	OnAutoStartProgress func(name string, index, total int)         // 自启进度回调（可选）
	OnAutoStartError    func(projectID, projectName, errMsg string) // 自启失败回调（可选，用于缓存错误供前端就绪后查询）
}

// managedProcess 单个被管理的进程实例
type managedProcess struct {
	projectID    string
	cmd          *exec.Cmd
	ctx          context.Context
	cancel       context.CancelFunc
	status       string
	pid          int
	startedAt    time.Time
	stopCh       chan struct{} // 进程退出信号
	restartCount int
	logFile      string         // 临时日志文件路径（文件模式捕获输出）
	stdin        io.WriteCloser // 进程 stdin 管道（用于发送命令）
	wg           sync.WaitGroup // 等待输出读取 goroutine 完成
}

// NewManager 创建进程管理器
func NewManager(cfg *config.Manager) *Manager {
	return &Manager{
		cfg:         cfg,
		processes:   make(map[string]*managedProcess),
		logBuf:      NewLogBuffer(defaultBufferSize),
		lastLogTime: make(map[string]time.Time),
	}
}

// SetAppContext 设置 Wails 应用上下文（用于事件推送）
// 使用 atomic.Value 存储，无需加锁，避免 emitLog 在持锁环境下重入死锁
func (m *Manager) SetAppContext(ctx context.Context) {
	m.appCtx.Store(ctx)
}

// StartProject 启动指定项目
func (m *Manager) StartProject(projectID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 检查是否已在运行
	if mp, ok := m.processes[projectID]; ok && mp.status == model.StatusRunning {
		return fmt.Errorf("项目 '%s' 已在运行中", projectID)
	}

	// 获取项目配置
	project := m.cfg.GetProject(projectID)
	if project == nil {
		return fmt.Errorf("项目 '%s' 不存在", projectID)
	}

	return m.startProcessLocked(project)
}

// StopProject 停止项目：cancel + taskkill /T /F，等待 3 秒，退出则更新状态返回，未退出则触发超时回调。
func (m *Manager) StopProject(projectID string) error {
	m.mu.Lock()
	mp, ok := m.processes[projectID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("项目 '%s' 未在运行", projectID)
	}
	if mp.status == model.StatusStopped || mp.status == model.StatusStopping {
		m.mu.Unlock()
		return nil
	}

	mp.status = model.StatusStopping
	pid := mp.pid
	m.mu.Unlock()

	m.emitLog(model.LogEntry{
		ProjectID: projectID,
		Source:    "system",
		Text:      fmt.Sprintf("正在停止进程 (PID: %d)...", pid),
		Timestamp: time.Now().UnixMilli(),
	})

	// 1. context 取消
	if mp.cancel != nil {
		mp.cancel()
	}

	// 2. taskkill /T /F 杀整棵进程树，捕获输出用于诊断
	if runtime.GOOS == "windows" && pid > 0 {
		killCmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid))
		killCmd.SysProcAttr = hideWindowAttr()
		output, err := killCmd.CombinedOutput()
		outputStr := decodeText(strings.TrimSpace(string(output)))
		if err != nil {
			log.Printf("[StopProject] taskkill PID=%d 失败: %v, 输出: %s", pid, err, outputStr)
			m.emitLog(model.LogEntry{
				ProjectID: projectID,
				Source:    "system",
				Text:      fmt.Sprintf("taskkill 输出: %s", outputStr),
				Level:     "warn",
				Timestamp: time.Now().UnixMilli(),
			})
		} else {
			log.Printf("[StopProject] taskkill PID=%d 成功: %s", pid, outputStr)
		}

		// 2b. 兜底：遍历进程 PPID 关系，清理 taskkill /T 漏掉的残留子进程
		time.Sleep(200 * time.Millisecond)
		m.killProcessTree(int32(pid))
	}

	// 3. 等待最多 3 秒
	select {
	case <-mp.stopCh:
		// 进程已退出
	case <-time.After(3 * time.Second):
		// 超时：进程未退出，通知前端弹窗确认强杀
		m.emitLog(model.LogEntry{
			ProjectID: projectID,
			Source:    "system",
			Text:      "进程 3 秒内未退出，等待用户确认强制终止...",
			Level:     "warn",
			Timestamp: time.Now().UnixMilli(),
		})
		if m.OnStopTimeout != nil {
			m.OnStopTimeout(projectID)
		}
		return nil
	}

	// 4. 进程已退出，更新状态
	m.mu.Lock()
	mp.status = model.StatusStopped
	m.cfg.SetProjectStatus(projectID, model.StatusStopped, 0)
	delete(m.processes, projectID)
	m.mu.Unlock()

	m.emitLog(model.LogEntry{
		ProjectID: projectID,
		Source:    "system",
		Text:      "进程已停止",
		Timestamp: time.Now().UnixMilli(),
	})

	return nil
}

// ForceStopProject 强制终止进程（用户确认后调用）
func (m *Manager) ForceStopProject(projectID string) error {
	m.mu.Lock()
	mp, ok := m.processes[projectID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("项目 '%s' 不存在", projectID)
	}
	pid := mp.pid
	m.mu.Unlock()

	m.emitLog(model.LogEntry{
		ProjectID: projectID,
		Source:    "system",
		Text:      fmt.Sprintf("正在强制终止进程 (PID: %d)...", pid),
		Level:     "warn",
		Timestamp: time.Now().UnixMilli(),
	})

	// 再次 taskkill（确保进程树被杀）
	if runtime.GOOS == "windows" && pid > 0 {
		forceCmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid))
		forceCmd.SysProcAttr = hideWindowAttr()
		forceCmd.Run()

		// 兜底：清理残留子进程
		time.Sleep(200 * time.Millisecond)
		m.killProcessTree(int32(pid))
	}

	// 等待最多 3 秒
	select {
	case <-mp.stopCh:
	case <-time.After(3 * time.Second):
	}

	// 无论是否退出都更新状态
	m.mu.Lock()
	mp.status = model.StatusStopped
	m.cfg.SetProjectStatus(projectID, model.StatusStopped, 0)
	delete(m.processes, projectID)
	m.mu.Unlock()

	m.emitLog(model.LogEntry{
		ProjectID: projectID,
		Source:    "system",
		Text:      "进程已强制终止",
		Timestamp: time.Now().UnixMilli(),
	})

	return nil
}

// RestartProject 重启指定项目
func (m *Manager) RestartProject(projectID string) error {
	// StopProject 现在是同步的，返回时进程已停止且状态已更新
	if err := m.StopProject(projectID); err != nil {
		// 忽略"未运行"的错误，仍然尝试启动
		if !strings.Contains(err.Error(), "未在运行") {
			return err
		}
	}
	return m.StartProject(projectID)
}

// StopAll 停止所有运行中的项目
func (m *Manager) StopAll() {
	m.mu.RLock()
	var ids []string
	for id, mp := range m.processes {
		if mp.status == model.StatusRunning {
			ids = append(ids, id)
		}
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.StopProject(id)
	}
}

// StartGroup 启动指定分组内的所有项目
func (m *Manager) StartGroup(groupID string) []string {
	projects := m.cfg.GetProjects()
	var started []string
	for _, p := range projects {
		if p.GroupID == groupID {
			if err := m.StartProject(p.ID); err == nil {
				started = append(started, p.ID)
			}
		}
	}
	return started
}

// StopGroup 停止指定分组内的所有项目
func (m *Manager) StopGroup(groupID string) []string {
	projects := m.cfg.GetProjects()
	var stopped []string
	for _, p := range projects {
		if p.GroupID == groupID {
			if err := m.StopProject(p.ID); err == nil {
				stopped = append(stopped, p.ID)
			}
		}
	}
	return stopped
}

// StartAutoStartProjects 启动所有标记为自动启动的项目（按 SortOrder 升序启动）
// 启动失败时通过 Wails Event 通知前端
func (m *Manager) StartAutoStartProjects() {
	projects := m.cfg.GetProjects()
	var autoProjects []model.Project
	for _, p := range projects {
		if p.AutoStart {
			autoProjects = append(autoProjects, p)
		}
	}

	sort.Slice(autoProjects, func(i, j int) bool {
		return autoProjects[i].SortOrder < autoProjects[j].SortOrder
	})
	total := len(autoProjects)
	for i, p := range autoProjects {
		if m.OnAutoStartProgress != nil {
			m.OnAutoStartProgress(p.Name, i+1, total)
		}
		err := m.StartProject(p.ID)
		if err != nil {
			log.Printf("[StartAutoStartProjects] 启动 %s(%s) 失败: %v", p.Name, p.ID, err)
			// 通过 Wails Event 通知前端（前端加载后自动显示）
			if ctx := m.appCtx.Load(); ctx != nil {
				wailsRuntime.EventsEmit(ctx.(context.Context), "autostart-error", map[string]interface{}{
					"projectId":   p.ID,
					"projectName": p.Name,
					"error":       err.Error(),
				})
			}
			// 通过回调缓存错误（前端就绪后查询，避免事件丢失）
			if m.OnAutoStartError != nil {
				m.OnAutoStartError(p.ID, p.Name, err.Error())
			}
		}
	}
}

// GetProcessInfo 获取指定项目的进程信息（含真实内存/CPU）
func (m *Manager) GetProcessInfo(projectID string) model.ProcessInfo {
	m.mu.RLock()
	mp, ok := m.processes[projectID]
	m.mu.RUnlock()

	if !ok {
		return model.ProcessInfo{
			ProjectID: projectID,
			Status:    model.StatusStopped,
		}
	}

	info := model.ProcessInfo{
		ProjectID:    projectID,
		Status:       mp.status,
		PID:          mp.pid,
		RestartCount: mp.restartCount,
	}

	// 从配置中获取端口（可能被日志自动检测更新）
	if proj := m.cfg.GetProject(projectID); proj != nil {
		info.Port = proj.Port
	}

	if mp.status == model.StatusRunning {
		info.Uptime = int64(time.Since(mp.startedAt).Seconds())

		// 用 gopsutil 获取进程树的真实内存和 CPU
		memMB, cpuPct := getProcessTreeStats(mp.pid)
		info.MemoryMB = memMB
		info.CPUPercent = cpuPct
	}

	return info
}

// getProcessTreeStats 递归获取进程及其所有子进程的内存和 CPU 总和
// PID 可能是 cmd.exe，实际工作进程（如 node.exe）是其子进程
func getProcessTreeStats(rootPID int) (memMB float64, cpuPct float64) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	visited := make(map[int32]bool)
	var collect func(pid int32) (float64, float64)
	collect = func(pid int32) (float64, float64) {
		if visited[pid] {
			return 0, 0
		}
		visited[pid] = true

		p, err := process.NewProcess(pid)
		if err != nil {
			return 0, 0
		}

		var totalMem, totalCPU float64

		// 内存 (RSS)
		if memInfo, err := p.MemoryInfoWithContext(ctx); err == nil && memInfo != nil {
			totalMem = float64(memInfo.RSS) / 1024 / 1024
		}

		// CPU 百分比（gopsutil 返回单核百分比，需除以核心数转为系统百分比）
		if pct, err := p.CPUPercentWithContext(ctx); err == nil {
			totalCPU = pct / float64(runtime.NumCPU())
		}

		// 递归子进程
		if children, err := p.ChildrenWithContext(ctx); err == nil {
			for _, child := range children {
				cm, cc := collect(child.Pid)
				totalMem += cm
				totalCPU += cc
			}
		}

		return totalMem, totalCPU
	}

	memMB, cpuPct = collect(int32(rootPID))
	// 确保不超过 100%
	if cpuPct > 100 {
		cpuPct = 100
	}
	return
}

// GetAllProcessInfo 获取所有项目的进程信息
func (m *Manager) GetAllProcessInfo() []model.ProcessInfo {
	projects := m.cfg.GetProjects()
	var result []model.ProcessInfo
	for _, p := range projects {
		result = append(result, m.GetProcessInfo(p.ID))
	}
	return result
}

// GetLogs 获取日志
func (m *Manager) GetLogs(projectID string, count int) []model.LogEntry {
	return m.logBuf.GetRecent(count, projectID)
}

// ClearLogs 清空日志
func (m *Manager) ClearLogs(projectID string) {
	m.logBuf.Clear(projectID)
}

// startProcessLocked 启动进程（调用者必须持有写锁）
// 使用文件模式捕获输出：将 stdout/stderr 重定向到临时日志文件，
// 然后在后台 goroutine 中 tail 该文件。这比管道模式更可靠，
// 尤其是在 Windows 上多层子进程（bat→powershell→node）的场景。
// hideWindowAttr 返回隐藏控制台窗口的 SysProcAttr（仅 Windows 有效）
// CREATE_NO_WINDOW (0x08000000) 阻止 cmd.exe/powershell.exe 弹出黑色控制台窗口
func hideWindowAttr() *syscall.SysProcAttr {
	if runtime.GOOS != "windows" {
		return nil
	}
	return &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}

// CheckPortInUse 检查端口是否被占用，返回占用进程的 PID 和名称（如果可用）
func (m *Manager) CheckPortInUse(port int) (pid int, name string) {
	if port <= 0 {
		return 0, ""
	}

	// 直接用 gopsutil 检查连接（net.Listen 不可靠，会误判）
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	conns, err := netos.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return 0, ""
	}

	for _, conn := range conns {
		if int(conn.Laddr.Port) == port && (conn.Status == "LISTEN" || conn.Status == "BOUND") {
			if conn.Pid > 0 {
				p, err := process.NewProcess(conn.Pid)
				if err == nil {
					if n, err := p.NameWithContext(ctx); err == nil && n != "" {
						return int(conn.Pid), n
					}
				}
				return int(conn.Pid), "unknown"
			}
		}
	}

	return 0, ""
}

// KillProcessByPID 通过 taskkill 终止指定 PID 的进程树
func (m *Manager) KillProcessByPID(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("无效的 PID: %d", pid)
	}
	cmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid))
	cmd.SysProcAttr = hideWindowAttr()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("终止进程 %d 失败: %v (输出: %s)", pid, err, decodeText(string(output)))
	}
	return nil
}

// killProcessTree 杀死 PID 及其所有子孙进程
// taskkill /T 依赖内核进程树关系，但 Windows 上父进程退出后子进程的 PPID 会变，
// 导致 taskkill /T 漏杀。本函数通过遍历所有进程的 PPID 手动查找子孙并逐一杀死。
func (m *Manager) killProcessTree(pid int32) {
	if pid <= 0 {
		return
	}

	// 1. 找到所有直接子进程
	allProcs, err := process.Processes()
	if err != nil {
		// 降级：只用 taskkill /T
		m.KillProcessByPID(int(pid))
		return
	}

	var children []int32
	for _, p := range allProcs {
		if int(p.Pid) == int(pid) {
			continue
		}
		ppid, err := p.Ppid()
		if err == nil && int(ppid) == int(pid) {
			children = append(children, p.Pid)
		}
	}

	// 2. 递归杀死子进程（先杀后代再杀自己，避免子进程被系统收养后找不到）
	for _, cpid := range children {
		m.killProcessTree(cpid)
	}

	// 3. 杀死目标进程本身
	killCmd := exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", pid))
	killCmd.SysProcAttr = hideWindowAttr()
	killCmd.Run()
}

// SendCommand 向项目的进程 stdin 发送命令
func (m *Manager) SendCommand(projectID string, command string) error {
	m.mu.RLock()
	mp, ok := m.processes[projectID]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("项目 '%s' 未在运行", projectID)
	}
	if mp.stdin == nil {
		return fmt.Errorf("进程 stdin 管道不可用")
	}

	// 写入命令并追加换行符
	_, err := fmt.Fprintln(mp.stdin, command)
	if err != nil {
		return fmt.Errorf("发送命令失败: %w", err)
	}

	// 记录系统日志
	m.emitLog(model.LogEntry{
		ProjectID: projectID,
		Source:    "stdin",
		Text:      command,
		Level:     "info",
		Timestamp: time.Now().UnixMilli(),
	})

	return nil
}

func (m *Manager) startProcessLocked(project *model.Project) error {
	ctx, cancel := context.WithCancel(context.Background())

	// 构建命令：智能判断执行方式
	cmd := buildCommand(ctx, project)

	// 设置工作目录
	if project.WorkDir != "" {
		workDir := os.ExpandEnv(project.WorkDir)
		cmd.Dir = workDir
	}

	// 设置环境变量
	cmd.Env = os.Environ()
	// 注入 Sliect Launcher 标识，让启动脚本可以检测并切换为前台运行模式
	cmd.Env = append(cmd.Env, "SLIECT_FOREGROUND=1")
	// 强制子进程使用行缓冲，防止输出被块缓冲吞掉
	cmd.Env = append(cmd.Env,
		"FORCE_LINE_BUFFERING=1",
		"NODE_DISABLE_COLORS=0",
		"PYTHONUNBUFFERED=1",
	)
	for k, v := range project.Env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// 创建临时日志文件用于捕获输出
	logFilePath, err := m.createLogFile(project.ID)
	if err != nil {
		cancel()
		return fmt.Errorf("创建日志文件失败: %w", err)
	}

	logFile, err := os.OpenFile(logFilePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		cancel()
		return fmt.Errorf("打开日志文件失败: %w", err)
	}

	// 将 stdout 和 stderr 都重定向到日志文件
	// 这比 StdoutPipe 更可靠：文件句柄在多层子进程间继承更稳定
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	// 隐藏控制台窗口：CREATE_NO_WINDOW 阻止 cmd.exe/powershell.exe 弹出黑色窗口
	cmd.SysProcAttr = hideWindowAttr()

	// 设置 stdin 管道，用于向进程发送命令（替代之前的 NUL 设备）
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		logFile.Close()
		cancel()
		return fmt.Errorf("创建 stdin 管道失败: %w", err)
	}

	// 启动进程
	if err := cmd.Start(); err != nil {
		logFile.Close()
		stdinPipe.Close()
		cancel()
		return fmt.Errorf("启动进程失败: %w", err)
	}

	// 关闭写入端，读取端通过 tail 文件来获取内容
	logFile.Close()

	pid := cmd.Process.Pid
	stopCh := make(chan struct{})

	mp := &managedProcess{
		projectID: project.ID,
		cmd:       cmd,
		ctx:       ctx,
		cancel:    cancel,
		status:    model.StatusRunning,
		pid:       pid,
		startedAt: time.Now(),
		stopCh:    stopCh,
		logFile:   logFilePath,
		stdin:     stdinPipe,
	}

	// 保留重启计数
	if old, ok := m.processes[project.ID]; ok {
		mp.restartCount = old.restartCount
	}

	m.processes[project.ID] = mp

	// 更新配置中的状态
	m.cfg.SetProjectStatus(project.ID, model.StatusRunning, pid)

	m.emitLog(model.LogEntry{
		ProjectID: project.ID,
		Source:    "system",
		Text:      fmt.Sprintf("进程已启动 (PID: %d)", pid),
		Timestamp: time.Now().UnixMilli(),
	})

	// 在后台 goroutine 中 tail 日志文件
	mp.wg.Add(1)
	go m.tailLogFile(mp)

	// 在后台 goroutine 中监控进程退出
	go m.watchProcess(mp, project)

	return nil
}

// createLogFile 为项目创建临时日志文件，返回文件路径
func (m *Manager) createLogFile(projectID string) (string, error) {
	logDir := filepath.Join(os.TempDir(), "SliectLauncher")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return "", err
	}
	// 用项目 ID 做文件名，方便调试时查看
	safeID := strings.ReplaceAll(projectID, string(os.PathSeparator), "_")
	return filepath.Join(logDir, safeID+".log"), nil
}

// tailLogFile 持续监控日志文件，读取新增内容并推送到日志缓冲区
// 这是文件模式的输出捕获，比管道模式在 Windows 上更可靠
func (m *Manager) tailLogFile(mp *managedProcess) {
	defer mp.wg.Done()

	projectID := mp.projectID
	logFile := mp.logFile

	f, err := os.Open(logFile)
	if err != nil {
		log.Printf("[tailLogFile] 打开日志文件失败: %v", err)
		return
	}
	defer f.Close()

	var offset int64
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			offset = m.readNewLines(f, offset, projectID)
		case <-mp.stopCh:
			// 进程已退出，等待最后的输出刷入文件
			time.Sleep(800 * time.Millisecond)
			m.readNewLines(f, offset, projectID)
			return
		}
	}
}

// decodeText 检测并解码进程输出文本
// Windows 上 cmd.exe/bat 脚本默认输出 GBK (CP936) 编码，
// 需要转换为 UTF-8 才能在前端正确显示中文。
// 如果文本已经是合法 UTF-8，原样返回；否则尝试 GB18030 解码。
func decodeText(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	// 尝试 GB18030 解码（GB18030 是 GBK 的超集，兼容性最好）
	decoded, _, err := transform.String(simplifiedchinese.GB18030.NewDecoder(), s)
	if err == nil && decoded != "" {
		return decoded
	}
	return s
}

// readNewLines 从文件当前偏移量读取新行，返回新的偏移量
func (m *Manager) readNewLines(f *os.File, offset int64, projectID string) int64 {
	f.Seek(offset, 0)
	reader := bufio.NewReader(f)

	hasNewLines := false
	for {
		line, err := reader.ReadString('\n')
		// 处理已读取的内容（无论是否有错误）
		text := strings.TrimRight(line, "\r\n")
		if text != "" {
			hasNewLines = true
			decoded := decodeText(text)
			entry := model.LogEntry{
				ProjectID: projectID,
				Source:    "stdout",
				Level:     parseLogLevel(decoded, "stdout"),
				Text:      decoded,
				Timestamp: time.Now().UnixMilli(),
			}
			m.emitLog(entry)
		}
		if err != nil {
			// EOF 或出错：不推进偏移量到不完整行的末尾
			// 只前进到最后一个完整行的结尾
			lineLen := int64(len(line))
			if lineLen > 0 && err == io.EOF {
				// 不完整的行：回退到该行开头，下次再读
				offset += 0 // 不推进
			}
			break
		}
		// 完整行：推进偏移量
		offset += int64(len(line))
	}

	// 更新最后日志时间
	if hasNewLines {
		m.mu.Lock()
		m.lastLogTime[projectID] = time.Now()
		m.mu.Unlock()
	}

	return offset
}

// watchProcess 监控进程退出状态
func (m *Manager) watchProcess(mp *managedProcess, project *model.Project) {
	err := mp.cmd.Wait()
	close(mp.stopCh) // 通知进程已退出

	// 等待日志读取 goroutine 完成最后的读取（最多 2 秒）
	done := make(chan struct{})
	go func() {
		mp.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}

	m.mu.Lock()
	currentStatus := mp.status

	// 如果 StopProject 已将状态设为 Stopped 或 Stopping（说明是用户主动停止），
	// StopProject 会自己处理状态更新和 map 清理，这里只需确保不触发自动重启
	if currentStatus == model.StatusStopped || currentStatus == model.StatusStopping {
		// StopProject 已处理或正在处理，watchProcess 不做额外操作
		// 如果进程还在 map 里（StopProject 还没执行到 delete），这里也不处理
		m.mu.Unlock()
		return
	}

	// 非预期退出 → 标记为崩溃
	mp.status = model.StatusCrashed
	m.cfg.SetProjectStatus(project.ID, model.StatusCrashed, 0)
	m.mu.Unlock()

	exitMsg := "进程异常退出"
	if err != nil {
		exitMsg = fmt.Sprintf("进程异常退出: %v", err)
	}
	m.emitLog(model.LogEntry{
		ProjectID: project.ID,
		Source:    "system",
		Text:      exitMsg,
		Timestamp: time.Now().UnixMilli(),
	})

	// 检查是否需要自动重启
	shouldRestart := (project.AutoRestart || m.cfg.GetConfig().AutoRestartGlobal) &&
		(project.MaxRestartCount <= 0 || mp.restartCount < project.MaxRestartCount)

	// Phase 6：推送崩溃事件到通知中心
	if ctx, ok := m.appCtx.Load().(context.Context); ok && ctx != nil {
		wailsRuntime.EventsEmit(ctx, "process-crashed", map[string]interface{}{
			"projectId":    project.ID,
			"name":         project.Name,
			"exitTime":     time.Now().UnixMilli(),
			"exitMsg":      exitMsg,
			"willRestart":  shouldRestart,
			"restartCount": mp.restartCount,
		})
	}

	if shouldRestart {
		delay := time.Duration(project.RestartDelay) * time.Second
		if delay <= 0 {
			delay = 3 * time.Second
		}

		m.emitLog(model.LogEntry{
			ProjectID: project.ID,
			Source:    "system",
			Text:      fmt.Sprintf("将在 %v 后自动重启 (第 %d 次)...", delay, mp.restartCount+1),
			Timestamp: time.Now().UnixMilli(),
		})

		time.Sleep(delay)

		m.mu.Lock()
		// 用户可能在重启等待期间点击了停止，此时不应重启
		if mp.status == model.StatusStopped || mp.status == model.StatusStopping {
			m.mu.Unlock()
			return
		}

		// 检查端口是否被占用（上一个进程的子进程可能还没释放端口）
		// 同时检查配置端口和自动检测端口
		p := m.cfg.GetProject(project.ID)
		portsToCheck := make(map[int]bool)
		if p != nil && p.Port > 0 {
			portsToCheck[p.Port] = true
		}
		// 也检查自动检测到的端口（从日志解析）
		if detectedPort := m.cfg.GetProjectPort(project.ID); detectedPort > 0 {
			portsToCheck[detectedPort] = true
		}

		for port := range portsToCheck {
			if pid, name := m.CheckPortInUse(port); pid > 0 {
				m.mu.Unlock()
				m.emitLog(model.LogEntry{
					ProjectID: project.ID,
					Source:    "system",
					Text:      fmt.Sprintf("端口 %d 被「%s」(PID: %d) 占用，暂停自动重启", port, name, pid),
					Level:     "warn",
					Timestamp: time.Now().UnixMilli(),
				})
				// 通知前端弹窗
				if ctx, ok := m.appCtx.Load().(context.Context); ok && ctx != nil {
					wailsRuntime.EventsEmit(ctx, "port-conflict", map[string]interface{}{
						"projectId":   project.ID,
						"port":        port,
						"pid":         pid,
						"processName": name,
					})
				}
				return
			}
		}

		mp.restartCount++
		if p != nil {
			m.startProcessLocked(p)
		}
		m.mu.Unlock()

		// Phase 6：推送自动重启事件到通知中心
		if ctx, ok := m.appCtx.Load().(context.Context); ok && ctx != nil {
			wailsRuntime.EventsEmit(ctx, "process-restarted", map[string]interface{}{
				"projectId":    project.ID,
				"name":         project.Name,
				"restartTime":  time.Now().UnixMilli(),
				"restartCount": mp.restartCount,
			})
		}
	}
}

// emitLog 推送日志事件到前端
// 使用 atomic.Value 无锁读取 appCtx，可在任何持锁环境下安全调用
func (m *Manager) emitLog(entry model.LogEntry) {
	m.logBuf.Add(entry)

	// 自动检测端口：从 stdout 日志中提取端口号
	if entry.Source == "stdout" || entry.Source == "stderr" {
		if port := detectPort(entry.Text); port > 0 {
			m.cfg.SetProjectPort(entry.ProjectID, port)
		}
		// 也检测 EADDRINUSE 错误中的端口（端口冲突时自动记录）
		if strings.Contains(strings.ToUpper(entry.Text), "EADDRINUSE") {
			if port := detectPort(entry.Text); port > 0 {
				m.cfg.SetProjectPort(entry.ProjectID, port)
			}
		}
	}

	if ctx, ok := m.appCtx.Load().(context.Context); ok && ctx != nil {
		wailsRuntime.EventsEmit(ctx, "log", entry)
	}
}

// portRegex 匹配日志中的端口号
var portRegex = regexp.MustCompile(`(?:localhost|127\.0\.0\.1|0\.0\.0\.0|listen(?:ing)?\s*(?:on)?\s*[:：]|端口|port)\s*[:：]?\s*(\d{2,5})`)

// detectPort 从日志文本中提取端口号
func detectPort(text string) int {
	matches := portRegex.FindStringSubmatch(strings.ToLower(text))
	if len(matches) < 2 {
		return 0
	}
	var port int
	fmt.Sscanf(matches[1], "%d", &port)
	if port < 1 || port > 65535 {
		return 0
	}
	return port
}

// GetDebugInfo 返回项目的诊断信息
func (m *Manager) GetDebugInfo(projectID string) map[string]interface{} {
	info := map[string]interface{}{
		"projectId": projectID,
	}

	m.mu.RLock()
	mp, ok := m.processes[projectID]
	m.mu.RUnlock()

	if !ok {
		info["inMap"] = false
	} else {
		info["inMap"] = true
		info["status"] = mp.status
		info["pid"] = mp.pid
		info["logFile"] = mp.logFile
		info["restartCount"] = mp.restartCount
		if mp.ctx != nil {
			info["ctxErr"] = fmt.Sprintf("%v", mp.ctx.Err())
		}
	}

	// 日志文件信息
	if mp != nil && mp.logFile != "" {
		if fi, err := os.Stat(mp.logFile); err == nil {
			info["logFileSize"] = fi.Size()
			info["logFileMod"] = fi.ModTime().Format("15:04:05")
		} else {
			info["logFileError"] = err.Error()
		}
	}

	// 日志缓冲区条目数
	logs := m.logBuf.GetRecent(99999, projectID)
	info["bufferCount"] = len(logs)

	return info
}

// buildCommand 智能构建 exec.Cmd，根据命令类型选择正确的执行方式
func buildCommand(ctx context.Context, project *model.Project) *exec.Cmd {
	command := os.ExpandEnv(project.Command)
	args := expandArgs(project.Args)

	// 判断命令类型
	cmdLower := strings.ToLower(strings.TrimSpace(command))
	isBatchFile := strings.HasSuffix(cmdLower, ".bat") || strings.HasSuffix(cmdLower, ".cmd")
	isShellScript := strings.HasSuffix(cmdLower, ".sh") || strings.HasSuffix(cmdLower, ".ps1")
	hasShellMeta := strings.ContainsAny(command, "&|><^%") || strings.Contains(command, "&&") || strings.Contains(command, "||")
	isMultiLine := strings.Contains(command, "\n") || strings.Contains(command, "\r")

	if runtime.GOOS == "windows" {
		// Windows 平台
		switch {
		case isBatchFile:
			// .bat/.cmd 文件：通过 cmd.exe /c 执行
			allArgs := append([]string{"/c", command}, args...)
			return exec.CommandContext(ctx, "cmd.exe", allArgs...)

		case strings.HasSuffix(cmdLower, ".ps1"):
			// PowerShell 脚本
			allArgs := append([]string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command}, args...)
			return exec.CommandContext(ctx, "powershell.exe", allArgs...)

		case isMultiLine || hasShellMeta:
			// 多行命令或包含 shell 元字符：整体交给 cmd.exe /c
			return exec.CommandContext(ctx, "cmd.exe", "/c", command)

		case len(args) > 0:
			// 有独立参数数组：直接执行
			return exec.CommandContext(ctx, command, args...)

		default:
			// 无参数数组：尝试按空格拆分命令
			parts := splitCommand(command)
			if len(parts) > 1 {
				return exec.CommandContext(ctx, parts[0], parts[1:]...)
			}
			return exec.CommandContext(ctx, command)
		}
	}

	// Unix 平台（macOS/Linux）
	switch {
	case isShellScript || hasShellMeta || isMultiLine:
		allArgs := append([]string{"-c", command}, args...)
		return exec.CommandContext(ctx, "/bin/sh", allArgs...)
	case len(args) > 0:
		return exec.CommandContext(ctx, command, args...)
	default:
		parts := splitCommand(command)
		if len(parts) > 1 {
			return exec.CommandContext(ctx, parts[0], parts[1:]...)
		}
		return exec.CommandContext(ctx, command)
	}
}

// splitCommand 按空格拆分命令字符串，但保留引号内的内容
func splitCommand(cmd string) []string {
	var parts []string
	var current strings.Builder
	inQuote := false
	quoteChar := byte(0)

	for i := 0; i < len(cmd); i++ {
		c := cmd[i]
		switch {
		case !inQuote && (c == '"' || c == '\''):
			inQuote = true
			quoteChar = c
		case inQuote && c == quoteChar:
			inQuote = false
		case !inQuote && c == ' ':
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
		default:
			current.WriteByte(c)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

// expandArgs 展开参数列表中的环境变量
func expandArgs(args []string) []string {
	result := make([]string, len(args))
	for i, arg := range args {
		result[i] = os.ExpandEnv(arg)
	}
	return result
}

// resolveCommandPath 尝试在工作目录中解析命令的完整路径
func resolveCommandPath(command, workDir string) string {
	if filepath.IsAbs(command) {
		return command
	}

	// 尝试在工作目录中查找
	if workDir != "" {
		full := filepath.Join(workDir, command)
		if _, err := os.Stat(full); err == nil {
			return full
		}
		// 加上 .exe 后缀再试
		if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(command), ".exe") {
			fullExe := full + ".exe"
			if _, err := os.Stat(fullExe); err == nil {
				return fullExe
			}
		}
	}

	return command
}

// parseLogLevel 从日志文本中检测日志级别
func parseLogLevel(text, source string) string {
	upper := strings.ToUpper(text)

	// 系统消息默认为 info
	if source == "system" {
		if strings.Contains(upper, "异常") || strings.Contains(upper, "失败") || strings.Contains(upper, "ERROR") {
			return "error"
		}
		if strings.Contains(upper, "警告") || strings.Contains(upper, "WARN") {
			return "warn"
		}
		return "info"
	}

	// 检测常见日志级别模式
	// 方括号风格: [ERROR], [WARN], [INFO], [DEBUG], [TRACE]
	// 冒号风格: ERROR:, WARN:, INFO:
	// 空格风格: ERROR , WARN , INFO
	patterns := []struct {
		level    string
		keywords []string
	}{
		{"error", []string{"[ERROR]", "[ERR]", "[FATAL]", "ERROR:", "ERR:", "FATAL:", " PANIC ", "✗", "❌"}},
		{"warn", []string{"[WARN]", "[WARNING]", "WARN:", "WARNING:", "⚠", "⚠️"}},
		{"info", []string{"[INFO]", "INFO:", "ℹ", "✓", "✔"}},
		{"debug", []string{"[DEBUG]", "[DBG]", "DEBUG:", "DBG:"}},
		{"trace", []string{"[TRACE]", "[TRC]", "TRACE:", "TRC:"}},
	}

	for _, p := range patterns {
		for _, kw := range p.keywords {
			if strings.Contains(upper, kw) {
				return p.level
			}
		}
	}

	// stderr 默认为 warn，stdout 默认为 info
	if source == "stderr" {
		return "warn"
	}
	return "info"
}
