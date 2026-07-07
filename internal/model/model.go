package model

import "time"

// 项目状态枚举
const (
	StatusStopped  = "stopped"
	StatusStarting = "starting"
	StatusRunning  = "running"
	StatusStopping = "stopping"
	StatusCrashed  = "crashed"
)

// Project 被管理的单个项目
type Project struct {
	ID              string            `json:"id" yaml:"id"`
	Name            string            `json:"name" yaml:"name"`
	GroupID         string            `json:"groupId" yaml:"groupId"`
	Type            string            `json:"type" yaml:"type"` // 显示用标签，如 Go/Node/Python
	Command         string            `json:"command" yaml:"command"`
	Args            []string          `json:"args" yaml:"args"`
	WorkDir         string            `json:"workDir" yaml:"workDir"`
	Port            int               `json:"port" yaml:"port"`
	Env             map[string]string `json:"env" yaml:"env"`
	AutoStart       bool              `json:"autoStart" yaml:"autoStart"`
	AutoRestart     bool              `json:"autoRestart" yaml:"autoRestart"`
	MaxRestartCount int               `json:"maxRestartCount" yaml:"maxRestartCount"`
	RestartDelay    int               `json:"restartDelay" yaml:"restartDelay"` // 秒
	SortOrder       int               `json:"sortOrder" yaml:"sortOrder"`

	// 运行时状态（不持久化）
	Status       string    `json:"status" yaml:"-"`
	PID          int       `json:"pid" yaml:"-"`
	StartedAt    time.Time `json:"startedAt" yaml:"-"`
	StopReason   string    `json:"stopReason" yaml:"-"`
	RestartCount int       `json:"restartCount" yaml:"-"`
}

// Group 项目分组
type Group struct {
	ID        string `json:"id" yaml:"id"`
	Name      string `json:"name" yaml:"name"`
	SortOrder int    `json:"sortOrder" yaml:"sortOrder"`
}

// AppConfig 应用全局配置
type AppConfig struct {
	Version               int             `json:"version" yaml:"version"`
	Theme                 string          `json:"theme" yaml:"theme"`
	MinimizeToTray        bool            `json:"minimizeToTray" yaml:"minimizeToTray"`
	StartOnBoot           bool            `json:"startOnBoot" yaml:"startOnBoot"`
	AutoRestartGlobal     bool            `json:"autoRestartGlobal" yaml:"autoRestartGlobal"`
	GlobalMaxRestartCount int             `json:"globalMaxRestartCount" yaml:"globalMaxRestartCount"`
	Groups                []Group         `json:"groups" yaml:"groups"`
	Projects              []Project       `json:"projects" yaml:"projects"`
	Tasks                 []SchedulerTask `json:"tasks" yaml:"tasks"`
}

// SchedulerTask 计划任务（Phase 4）
type SchedulerTask struct {
	ID        string `json:"id" yaml:"id"`
	Name      string `json:"name" yaml:"name"`
	CronExpr  string `json:"cronExpr" yaml:"cronExpr"`   // 5 字段 cron 表达式（分 时 日 月 周）
	ProjectID string `json:"projectId" yaml:"projectId"` // 目标项目 ID
	Timeout   int    `json:"timeout" yaml:"timeout"`     // 超时秒数，0 = 不限制（fire-and-forget）
	Enabled   bool   `json:"enabled" yaml:"enabled"`     // 是否启用调度
	SortOrder int    `json:"sortOrder" yaml:"sortOrder"`

	// 运行时状态（不持久化）
	LastStatus   string `json:"lastStatus" yaml:"-"`   // success / failed / timeout / running / skipped
	LastRunAt    int64  `json:"lastRunAt" yaml:"-"`    // 上次执行开始时间戳（毫秒）
	LastDuration int64  `json:"lastDuration" yaml:"-"` // 上次执行耗时（毫秒）
}

// SchedulerTaskInput 前端创建/编辑计划任务时的输入
type SchedulerTaskInput struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CronExpr  string `json:"cronExpr"`
	ProjectID string `json:"projectId"`
	Timeout   int    `json:"timeout"`
	Enabled   bool   `json:"enabled"`
}

// SchedulerTaskLog 计划任务执行日志条目
type SchedulerTaskLog struct {
	TaskID    string `json:"taskId"`
	StartedAt int64  `json:"startedAt"` // 启动时间戳（毫秒）
	EndedAt   int64  `json:"endedAt"`   // 结束时间戳（毫秒），0 表示进行中
	Status    string `json:"status"`    // running / success / failed / timeout / skipped
	Message   string `json:"message"`   // 结果消息
	Duration  int64  `json:"duration"`  // 耗时（毫秒）
}

// PortInfo 端口占用信息（Phase 4 端口管理）
type PortInfo struct {
	Port        int    `json:"port"`
	Protocol    string `json:"protocol"` // tcp / udp
	Status      string `json:"status"`   // LISTEN / ESTABLISHED ...
	PID         int    `json:"pid"`
	ProcessName string `json:"processName"`
	LocalAddr   string `json:"localAddr"`
	RemoteAddr  string `json:"remoteAddr"`
}

// DirEntry 文件/目录条目（Phase 5 内嵌文件浏览）
type DirEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`    // 字节数，目录为 0
	ModTime int64  `json:"modTime"` // Unix 毫秒
}

// DirNode 目录树节点（仅文件夹，用于左栏树形导航）
type DirNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Children []*DirNode `json:"children"`
}

// ProjectInput 前端创建/编辑项目时的输入
type ProjectInput struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	GroupID         string            `json:"groupId"`
	Type            string            `json:"type"`
	Command         string            `json:"command"`
	Args            []string          `json:"args"`
	WorkDir         string            `json:"workDir"`
	Port            int               `json:"port"`
	Env             map[string]string `json:"env"`
	AutoStart       bool              `json:"autoStart"`
	AutoRestart     bool              `json:"autoRestart"`
	MaxRestartCount int               `json:"maxRestartCount"`
	RestartDelay    int               `json:"restartDelay"`
}

// GroupInput 前端创建/编辑分组时的输入
type GroupInput struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// LogEntry 单条日志
type LogEntry struct {
	ProjectID string `json:"projectId"`
	Source    string `json:"source"` // "stdout" 或 "stderr" 或 "system"
	Level     string `json:"level"`  // "error", "warn", "info", "debug", "trace"
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
}

// GlobalLogEntry 全局日志视图条目（Phase 3：跨项目日志聚合）
type GlobalLogEntry struct {
	LogEntry
	ProjectName string `json:"projectName"`
}

// ProcessInfo 进程运行信息（给前端展示用）
type ProcessInfo struct {
	ProjectID    string  `json:"projectId"`
	Status       string  `json:"status"`
	PID          int     `json:"pid"`
	Port         int     `json:"port"`
	Uptime       int64   `json:"uptime"` // 秒
	MemoryMB     float64 `json:"memoryMB"`
	CPUPercent   float64 `json:"cpuPercent"`
	RestartCount int     `json:"restartCount"`
}
