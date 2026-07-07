package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"SliectLauncher/internal/config"
	"SliectLauncher/internal/model"
	"SliectLauncher/internal/process"
	"SliectLauncher/internal/sysmonitor"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

// App 是 Wails 前端绑定的主结构体，所有暴露给前端的方法都挂在这里
type App struct {
	ctx       context.Context
	cfg       *config.Manager
	procMgr   *process.Manager
}

// NewApp 创建 App 实例
func NewApp() *App {
	return &App{}
}

// startup 应用启动时调用，初始化配置管理器和进程管理器
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 初始化配置管理器
	cfg, err := config.NewManager()
	if err != nil {
		log.Printf("配置初始化失败: %v", err)
		return
	}
	a.cfg = cfg

	// 初始化进程管理器
	a.procMgr = process.NewManager(cfg)
	a.procMgr.SetAppContext(ctx)

	// 注册停止超时回调：5 秒后进程未退出且无日志活动 → 通知前端弹窗确认强杀
	a.procMgr.OnStopTimeout = func(projectID string) {
		wailsRuntime.EventsEmit(ctx, "stop-timeout", projectID)
	}

	// 启动标记为自动启动的项目
	a.procMgr.StartAutoStartProjects()

	// 同步开机启动注册表（确保设置与实际注册表状态一致）
	appCfg := a.cfg.GetConfig()
	setStartOnBoot(appCfg.StartOnBoot)

	// 初始化系统托盘（在独立 goroutine 中运行，不阻塞主循环）
	go a.initTray()
}

// shutdown 应用关闭时调用，停止所有进程
func (a *App) shutdown(ctx context.Context) {
	// 清理系统托盘图标
	removeTrayIcon()

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
