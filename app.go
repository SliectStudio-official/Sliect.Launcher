package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"SliectLauncher/internal/config"
	"SliectLauncher/internal/filebrowser"
	"SliectLauncher/internal/model"
	"SliectLauncher/internal/portmgr"
	"SliectLauncher/internal/process"
	"SliectLauncher/internal/scheduler"
	"SliectLauncher/internal/sysmonitor"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

// App 是 Wails 前端绑定的主结构体，所有暴露给前端的方法都挂在这里
type App struct {
	ctx      context.Context
	cfg      *config.Manager
	procMgr  *process.Manager
	schedMgr *scheduler.Manager
	portMgr  *portmgr.Manager
	fileMgr  *filebrowser.Manager

	// 启动时缓存的自启错误（前端就绪后通过 GetStartupErrors 拉取，避免事件丢失）
	startupErrorsMu sync.Mutex
	startupErrors   []StartupError
}

// StartupError 自启项目启动失败的错误记录
type StartupError struct {
	ProjectID   string `json:"projectId"`
	ProjectName string `json:"projectName"`
	Error       string `json:"error"`
	Time        int64  `json:"time"`
}

// NewApp 创建 App 实例
func NewApp() *App {
	return &App{}
}

// GetVersion 返回应用版本号（通过 -ldflags 注入的 main.Version）
func (a *App) GetVersion() string {
	return Version
}

// startup 应用启动时调用，初始化配置管理器和进程管理器
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 显示配置文件路径
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("USERPROFILE") + `\AppData\Roaming`
	}
	configPath := appData + `\SliectLauncher\config.yaml`
	updateSplashStatus("正在读取配置文件: " + configPath)
	updateSplashProgress(0.10)

	// 初始化配置管理器
	cfg, err := config.NewManager()
	if err != nil {
		log.Printf("配置初始化失败: %v", err)
		updateSplashStatus("配置加载失败: " + err.Error())
		updateSplashProgress(1.0)
		closeSplash()
		wailsRuntime.WindowShow(ctx)
		// 致命错误：前端可能无法正常工作，用系统对话框通知用户
		go func() {
			wailsRuntime.MessageDialog(ctx, wailsRuntime.MessageDialogOptions{
				Type:    wailsRuntime.ErrorDialog,
				Title:   "Sliect Launcher — 配置错误",
				Message: fmt.Sprintf("配置文件加载失败：\n\n%v\n\n请检查配置文件后重新启动。", err),
			})
		}()
		return
	}
	a.cfg = cfg

	updateSplashStatus("正在初始化进程管理器...")
	updateSplashProgress(0.25)

	// 初始化进程管理器
	a.procMgr = process.NewManager(cfg)
	a.procMgr.SetAppContext(ctx)

	// 注册停止超时回调：5 秒后进程未退出且无日志活动 → 通知前端弹窗确认强杀
	a.procMgr.OnStopTimeout = func(projectID string) {
		wailsRuntime.EventsEmit(ctx, "stop-timeout", projectID)
	}

	// 注册自启进度回调：实时更新启动画面状态与进度条
	a.procMgr.OnAutoStartProgress = func(name string, index, total int) {
		updateSplashStatus(fmt.Sprintf("正在启动项目 (%d/%d): %s", index, total, name))
		// 自启阶段占 40% 进度（0.40 → 0.80）
		if total > 0 {
			p := 0.40 + 0.40*float32(index)/float32(total)
			updateSplashProgress(p)
		}
	}

	// 注册自启失败回调：缓存错误供前端就绪后查询（启动时前端事件监听尚未就绪，EventsEmit 会丢失）
	a.procMgr.OnAutoStartError = func(projectID, projectName, errMsg string) {
		a.startupErrorsMu.Lock()
		a.startupErrors = append(a.startupErrors, StartupError{
			ProjectID:   projectID,
			ProjectName: projectName,
			Error:       errMsg,
			Time:        time.Now().UnixMilli(),
		})
		a.startupErrorsMu.Unlock()
	}

	updateSplashStatus("正在加载计划任务调度器...")
	updateSplashProgress(0.35)

	// 初始化计划任务调度器（Phase 4）
	a.schedMgr = scheduler.NewManager(cfg, a.procMgr)
	a.schedMgr.Start(ctx)

	// 初始化端口管理器（Phase 4）
	a.portMgr = portmgr.NewManager(a.procMgr)

	// 初始化文件浏览器（Phase 5 内嵌面板）
	a.fileMgr = filebrowser.NewManager()

	updateSplashStatus("正在启动自启项目...")
	updateSplashProgress(0.40)

	// 启动标记为自动启动的项目
	a.procMgr.StartAutoStartProjects()

	updateSplashStatus("正在同步开机启动设置...")
	updateSplashProgress(0.90)

	// 同步开机启动注册表（确保设置与实际注册表状态一致）
	appCfg := a.cfg.GetConfig()
	setStartOnBoot(appCfg.StartOnBoot)

	// 初始化系统托盘（在独立 goroutine 中运行，不阻塞主循环）
	go a.initTray()

	// 启动画面淡出 → 显示主窗口
	updateSplashProgress(1.0)
	closeSplash()
	wailsRuntime.WindowShow(ctx)
}

// shutdown 应用关闭时调用，停止所有进程
func (a *App) shutdown(ctx context.Context) {
	// 清理系统托盘图标
	removeTrayIcon()

	// 停止计划任务调度器
	if a.schedMgr != nil {
		a.schedMgr.Stop()
	}

	if a.procMgr != nil {
		a.procMgr.StopAll()
	}
}

// beforeClose 窗口关闭前调用，如果"最小化到托盘"启用则隐藏窗口而非退出
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.cfg == nil {
		return false
	}
	cfg := a.cfg.GetConfig()
	if cfg.MinimizeToTray {
		wailsRuntime.WindowHide(ctx)
		return true // 阻止关闭，只隐藏
	}
	return false
}

// ========== 开机启动 ==========

const regRunKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const regValueName = "SliectLauncher"

// setStartOnBoot 设置或移除开机启动注册表项
func setStartOnBoot(enabled bool) {
	if enabled {
		exePath, err := os.Executable()
		if err != nil {
			log.Printf("获取可执行文件路径失败: %v", err)
			return
		}
		k, err := registry.OpenKey(registry.CURRENT_USER, regRunKey, registry.WRITE)
		if err != nil {
			log.Printf("打开注册表键失败: %v", err)
			return
		}
		defer k.Close()
		// 用引号包裹路径，防止路径含空格
		err = k.SetStringValue(regValueName, fmt.Sprintf(`"%s"`, exePath))
		if err != nil {
			log.Printf("设置注册表值失败: %v", err)
		}
	} else {
		k, err := registry.OpenKey(registry.CURRENT_USER, regRunKey, registry.WRITE)
		if err != nil {
			return
		}
		defer k.Close()
		k.DeleteValue(regValueName) // 忽略错误
	}
}

// ShowWindow 从托盘恢复窗口（供外部调用）
func (a *App) ShowWindow() {
	wailsRuntime.WindowShow(a.ctx)
	wailsRuntime.WindowSetAlwaysOnTop(a.ctx, true)
	wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false)
}

// ========== 项目管理 ==========

// GetProjects 获取所有项目列表
func (a *App) GetProjects() ([]model.Project, error) {
	if a.cfg == nil {
		return nil, fmt.Errorf("配置未初始化")
	}
	return a.cfg.GetProjects(), nil
}

// GetProject 获取单个项目
func (a *App) GetProject(id string) (*model.Project, error) {
	if a.cfg == nil {
		return nil, fmt.Errorf("配置未初始化")
	}
	p := a.cfg.GetProject(id)
	if p == nil {
		return nil, fmt.Errorf("项目 '%s' 不存在", id)
	}
	return p, nil
}

// AddProject 添加项目
func (a *App) AddProject(input model.ProjectInput) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	project := model.Project{
		ID:              input.ID,
		Name:            input.Name,
		GroupID:         input.GroupID,
		Type:            input.Type,
		Command:         input.Command,
		Args:            input.Args,
		WorkDir:         input.WorkDir,
		Port:            input.Port,
		Env:             input.Env,
		AutoStart:       input.AutoStart,
		AutoRestart:     input.AutoRestart,
		MaxRestartCount: input.MaxRestartCount,
		RestartDelay:    input.RestartDelay,
	}
	return a.cfg.AddProject(project)
}

// UpdateProject 更新项目配置
func (a *App) UpdateProject(input model.ProjectInput) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	project := model.Project{
		ID:              input.ID,
		Name:            input.Name,
		GroupID:         input.GroupID,
		Type:            input.Type,
		Command:         input.Command,
		Args:            input.Args,
		WorkDir:         input.WorkDir,
		Port:            input.Port,
		Env:             input.Env,
		AutoStart:       input.AutoStart,
		AutoRestart:     input.AutoRestart,
		MaxRestartCount: input.MaxRestartCount,
		RestartDelay:    input.RestartDelay,
	}
	return a.cfg.UpdateProject(project)
}

// DeleteProject 删除项目
func (a *App) DeleteProject(id string) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	// 先停止进程
	if a.procMgr != nil {
		a.procMgr.StopProject(id) // 忽略错误
	}
	return a.cfg.DeleteProject(id)
}

// ========== 进程控制 ==========

// StartProject 启动项目进程
func (a *App) StartProject(id string) error {
	if a.procMgr == nil {
		return fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.StartProject(id)
}

// StopProject 停止项目进程
func (a *App) StopProject(id string) error {
	if a.procMgr == nil {
		return fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.StopProject(id)
}

// RestartProject 重启项目进程
func (a *App) RestartProject(id string) error {
	if a.procMgr == nil {
		return fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.RestartProject(id)
}

// ForceStopProject 强制终止项目进程（taskkill /T /F），由前端超时弹窗确认后调用
func (a *App) ForceStopProject(id string) error {
	if a.procMgr == nil {
		return fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.ForceStopProject(id)
}

// SendCommand 向运行中的项目进程发送 stdin 命令
func (a *App) SendCommand(projectID string, command string) error {
	if a.procMgr == nil {
		return fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.SendCommand(projectID, command)
}

// ========== 分组管理 ==========

// GetGroups 获取所有分组
func (a *App) GetGroups() ([]model.Group, error) {
	if a.cfg == nil {
		return nil, fmt.Errorf("配置未初始化")
	}
	return a.cfg.GetGroups(), nil
}

// AddGroup 添加分组
func (a *App) AddGroup(input model.GroupInput) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	group := model.Group{
		ID:   input.ID,
		Name: input.Name,
	}
	return a.cfg.AddGroup(group)
}

// UpdateGroup 更新分组
func (a *App) UpdateGroup(input model.GroupInput) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	group := model.Group{
		ID:   input.ID,
		Name: input.Name,
	}
	return a.cfg.UpdateGroup(group)
}

// DeleteGroup 删除分组
func (a *App) DeleteGroup(id string) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	return a.cfg.DeleteGroup(id)
}

// StartGroup 启动分组内所有项目
func (a *App) StartGroup(groupID string) ([]string, error) {
	if a.procMgr == nil {
		return nil, fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.StartGroup(groupID), nil
}

// StopGroup 停止分组内所有项目
func (a *App) StopGroup(groupID string) ([]string, error) {
	if a.procMgr == nil {
		return nil, fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.StopGroup(groupID), nil
}

// ========== 日志 ==========

// GetLogs 获取项目日志
func (a *App) GetLogs(projectID string, count int) ([]model.LogEntry, error) {
	if a.procMgr == nil {
		return nil, fmt.Errorf("进程管理器未初始化")
	}
	if count <= 0 {
		count = 100
	}
	return a.procMgr.GetLogs(projectID, count), nil
}

// GetAllLogs 获取所有项目的日志聚合（Phase 3：全局日志查看器）
// 按时间戳降序返回，每条带 ProjectName
func (a *App) GetAllLogs(count int) []model.GlobalLogEntry {
	if a.procMgr == nil {
		return []model.GlobalLogEntry{}
	}
	if count <= 0 {
		count = 100
	}
	// 构建项目 ID → 名称映射
	idToName := make(map[string]string)
	for _, p := range a.cfg.GetProjects() {
		idToName[p.ID] = p.Name
	}

	var all []model.GlobalLogEntry
	for _, p := range a.cfg.GetProjects() {
		logs := a.procMgr.GetLogs(p.ID, count)
		for _, l := range logs {
			name := p.Name
			if name == "" {
				name = p.ID
			}
			all = append(all, model.GlobalLogEntry{
				LogEntry:    l,
				ProjectName: name,
			})
		}
	}

	// 按时间戳降序（最新在前）
	sort.Slice(all, func(i, j int) bool {
		return all[i].Timestamp > all[j].Timestamp
	})

	// 限制总数
	if len(all) > count*5 {
		all = all[:count*5]
	}
	return all
}

// ClearLogs 清空项目日志
func (a *App) ClearLogs(projectID string) {
	if a.procMgr != nil {
		a.procMgr.ClearLogs(projectID)
	}
}

// ========== 进程状态 ==========

// GetProcessInfo 获取单个项目的进程状态
func (a *App) GetProcessInfo(projectID string) (model.ProcessInfo, error) {
	if a.procMgr == nil {
		return model.ProcessInfo{}, fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.GetProcessInfo(projectID), nil
}

// GetAllProcessInfo 获取所有项目的进程状态
func (a *App) GetAllProcessInfo() ([]model.ProcessInfo, error) {
	if a.procMgr == nil {
		return nil, fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.GetAllProcessInfo(), nil
}

// ========== 全局设置 ==========

// GetGlobalSettings 获取全局设置
func (a *App) GetGlobalSettings() (model.AppConfig, error) {
	if a.cfg == nil {
		return model.AppConfig{}, fmt.Errorf("配置未初始化")
	}
	return a.cfg.GetConfig(), nil
}

// UpdateGlobalSettings 更新全局设置
func (a *App) UpdateGlobalSettings(theme string, minimizeToTray, startOnBoot, autoRestart bool, globalMaxRestartCount int) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	err := a.cfg.UpdateGlobalSettings(theme, minimizeToTray, startOnBoot, autoRestart, globalMaxRestartCount)
	if err != nil {
		return err
	}
	// 同步开机启动注册表
	setStartOnBoot(startOnBoot)
	return nil
}

// OpenURL 在系统默认浏览器中打开URL
func (a *App) OpenURL(url string) error {
	if a.ctx == nil {
		return fmt.Errorf("上下文未初始化")
	}
	wailsRuntime.BrowserOpenURL(a.ctx, url)
	return nil
}

// CheckPortInUse 检查端口是否被占用，返回占用进程信息
func (a *App) CheckPortInUse(port int) map[string]interface{} {
	if a.procMgr == nil {
		return nil
	}
	pid, name := a.procMgr.CheckPortInUse(port)
	if pid <= 0 {
		return nil
	}
	return map[string]interface{}{
		"pid":         pid,
		"processName": name,
		"port":        port,
	}
}

// KillProcessByPID 通过 PID 终止进程树
func (a *App) KillProcessByPID(pid int) error {
	if a.procMgr == nil {
		return fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.KillProcessByPID(pid)
}

// ========== 窗口控制（无边框自定义标题栏）==========

// WindowMinimise 最小化窗口
func (a *App) WindowMinimise() {
	wailsRuntime.WindowMinimise(a.ctx)
}

// WindowMaximise 最大化窗口
func (a *App) WindowMaximise() {
	wailsRuntime.WindowMaximise(a.ctx)
}

// WindowUnmaximise 取消最大化窗口
func (a *App) WindowUnmaximise() {
	wailsRuntime.WindowUnmaximise(a.ctx)
}

// WindowClose 关闭窗口
func (a *App) WindowClose() {
	wailsRuntime.Quit(a.ctx)
}

// StartWindowDrag 使用 Windows API 启动原生窗口拖拽
func (a *App) StartWindowDrag() {
	startWindowDragNative()
}

// WindowSetPosition 设置窗口位置（用于 JS 拖拽）
func (a *App) WindowSetPosition(x, y int) {
	wailsRuntime.WindowSetPosition(a.ctx, x, y)
}

// WindowGetPosition 获取窗口当前位置
func (a *App) WindowGetPosition() (int, int) {
	return wailsRuntime.WindowGetPosition(a.ctx)
}

// ========== 系统对话框 ==========

// SelectFile 打开文件选择对话框
func (a *App) SelectFile(title string, filters string) (string, error) {
	opts := wailsRuntime.OpenDialogOptions{
		Title: title,
	}
	if filters != "" {
		// 格式: "可执行文件:*.exe;*.bat;*.cmd|所有文件:*.*"
		for _, group := range splitFilters(filters) {
			parts := strings.SplitN(group, ":", 2)
			if len(parts) == 2 {
				opts.Filters = append(opts.Filters, wailsRuntime.FileFilter{
					DisplayName: parts[0],
					Pattern:     parts[1],
				})
			}
		}
	}
	return wailsRuntime.OpenFileDialog(a.ctx, opts)
}

// SelectFolder 打开目录选择对话框
func (a *App) SelectFolder(title string) (string, error) {
	return wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: title,
	})
}

// SelectExecutable 打开可执行文件选择对话框（便捷方法）
func (a *App) SelectExecutable() (string, error) {
	return wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "选择可执行文件",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "可执行文件", Pattern: "*.exe;*.bat;*.cmd;*.ps1"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
}

// splitFilters 拆分过滤器字符串
func splitFilters(s string) []string {
	var result []string
	for _, part := range strings.Split(s, "|") {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

// ========== 系统监控 ==========

// GetSystemStats 获取系统资源统计（CPU/内存/交换分区）
func (a *App) GetSystemStats() sysmonitor.SystemStats {
	return sysmonitor.GetSystemStats()
}

// GetTopProcesses 获取 Top5 进程（按 CPU 和内存排序）
func (a *App) GetTopProcesses() sysmonitor.TopProcesses {
	return sysmonitor.GetTopProcesses(5)
}

// GetFullSystemStats 获取完整系统统计（CPU/内存 + 磁盘使用 + 磁盘IO + 网络IO）
// Phase 2 新增：供仪表盘折线图与系统信息页使用
func (a *App) GetFullSystemStats() sysmonitor.FullSystemStats {
	return sysmonitor.GetFullSystemStats()
}

// GetDiskUsage 获取所有磁盘分区使用情况
func (a *App) GetDiskUsage() []sysmonitor.DiskUsage {
	return sysmonitor.GetDiskUsage()
}

// GetDiskIOStats 获取磁盘 IO 统计（含每秒速率）
func (a *App) GetDiskIOStats() []sysmonitor.DiskIOStats {
	return sysmonitor.GetDiskIOStats()
}

// GetNetIOStats 获取网络 IO 统计（含每秒速率）
func (a *App) GetNetIOStats() []sysmonitor.NetIOStats {
	return sysmonitor.GetNetIOStats()
}

// GetLogStats 获取所有项目的日志级别统计
func (a *App) GetLogStats() map[string]int {
	stats := map[string]int{"error": 0, "warn": 0, "info": 0, "debug": 0, "trace": 0}
	if a.procMgr == nil {
		return stats
	}
	// 获取所有项目的日志
	for _, p := range a.cfg.GetProjects() {
		logs := a.procMgr.GetLogs(p.ID, 500)
		for _, entry := range logs {
			if _, ok := stats[entry.Level]; ok {
				stats[entry.Level]++
			}
		}
	}
	return stats
}

// GetDebugInfo 获取项目诊断信息
func (a *App) GetDebugInfo(projectID string) (map[string]interface{}, error) {
	if a.procMgr == nil {
		return nil, fmt.Errorf("进程管理器未初始化")
	}
	return a.procMgr.GetDebugInfo(projectID), nil
}

// ========== 计划任务（Phase 4） ==========

// GetTasks 获取所有计划任务
func (a *App) GetTasks() ([]model.SchedulerTask, error) {
	if a.cfg == nil {
		return nil, fmt.Errorf("配置未初始化")
	}
	return a.cfg.GetTasks(), nil
}

// AddTask 添加计划任务
func (a *App) AddTask(input model.SchedulerTaskInput) error {
	if a.schedMgr == nil {
		return fmt.Errorf("调度器未初始化")
	}
	task := model.SchedulerTask{
		ID:        input.ID,
		Name:      input.Name,
		CronExpr:  input.CronExpr,
		ProjectID: input.ProjectID,
		Timeout:   input.Timeout,
		Enabled:   input.Enabled,
	}
	return a.schedMgr.AddTask(task)
}

// UpdateTask 更新计划任务
func (a *App) UpdateTask(input model.SchedulerTaskInput) error {
	if a.schedMgr == nil {
		return fmt.Errorf("调度器未初始化")
	}
	task := model.SchedulerTask{
		ID:        input.ID,
		Name:      input.Name,
		CronExpr:  input.CronExpr,
		ProjectID: input.ProjectID,
		Timeout:   input.Timeout,
		Enabled:   input.Enabled,
	}
	return a.schedMgr.UpdateTask(task)
}

// DeleteTask 删除计划任务
func (a *App) DeleteTask(id string) error {
	if a.schedMgr == nil {
		return fmt.Errorf("调度器未初始化")
	}
	return a.schedMgr.DeleteTask(id)
}

// GetTaskLogs 获取计划任务的执行日志（最近 50 条）
func (a *App) GetTaskLogs(taskID string) ([]model.SchedulerTaskLog, error) {
	if a.schedMgr == nil {
		return nil, fmt.Errorf("调度器未初始化")
	}
	return a.schedMgr.GetLogs(taskID), nil
}

// RunTaskNow 立即执行一次计划任务
func (a *App) RunTaskNow(id string) error {
	if a.schedMgr == nil {
		return fmt.Errorf("调度器未初始化")
	}
	return a.schedMgr.RunTaskNow(id)
}

// ========== 端口管理（Phase 4） ==========

// GetPortList 获取所有被占用端口列表
func (a *App) GetPortList() ([]model.PortInfo, error) {
	if a.portMgr == nil {
		return nil, fmt.Errorf("端口管理器未初始化")
	}
	return a.portMgr.ListPorts()
}

// KillPort 终止占用指定端口的进程
func (a *App) KillPort(port int) error {
	if a.portMgr == nil {
		return fmt.Errorf("端口管理器未初始化")
	}
	return a.portMgr.KillPort(port)
}

// ========== 文件浏览（Phase 5 内嵌面板） ==========

// ListDir 列出指定目录下的条目（目录在前，按名称排序）
// path 为空时返回逻辑驱动器列表
func (a *App) ListDir(path string) ([]model.DirEntry, error) {
	if a.fileMgr == nil {
		return nil, fmt.Errorf("文件浏览器未初始化")
	}
	return a.fileMgr.ListDir(path)
}

// GetDirTree 获取目录树（仅文件夹），用于左栏树形导航
// maxDepth 限制深度，0 表示仅根节点，默认 2 层
func (a *App) GetDirTree(root string, maxDepth int) (*model.DirNode, error) {
	if a.fileMgr == nil {
		return nil, fmt.Errorf("文件浏览器未初始化")
	}
	return a.fileMgr.GetDirTree(root, maxDepth)
}

// ========== 启动错误查询 ==========

// GetStartupErrors 返回并清空启动时缓存的自启错误（前端就绪后调用一次）
func (a *App) GetStartupErrors() []StartupError {
	a.startupErrorsMu.Lock()
	defer a.startupErrorsMu.Unlock()
	errs := a.startupErrors
	a.startupErrors = nil
	return errs
}

// ========== 启动项排序（Phase 5） ==========

// ReorderAutoStartProjects 按给定 ID 顺序更新自启项目的启动顺序
// 仅影响 AutoStart=true 的项目
func (a *App) ReorderAutoStartProjects(orderedIDs []string) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	return a.cfg.ReorderAutoStartProjects(orderedIDs)
}

// ========== 配置备份恢复（Phase 6） ==========

// ExportConfig 导出当前配置为 YAML 字符串
func (a *App) ExportConfig() (string, error) {
	if a.cfg == nil {
		return "", fmt.Errorf("配置未初始化")
	}
	return a.cfg.ExportConfig()
}

// ImportConfig 从 YAML 字符串导入配置（合并模式，保留运行时状态）
func (a *App) ImportConfig(yamlContent string) error {
	if a.cfg == nil {
		return fmt.Errorf("配置未初始化")
	}
	return a.cfg.ImportConfig(yamlContent)
}
