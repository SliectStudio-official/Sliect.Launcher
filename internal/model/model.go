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
	Status      string    `json:"status" yaml:"-"`
	PID         int       `json:"pid" yaml:"-"`
	StartedAt   time.Time `json:"startedAt" yaml:"-"`
	StopReason  string    `json:"stopReason" yaml:"-"`
	RestartCount int      `json:"restartCount" yaml:"-"`
}

// Group 项目分组
type Group struct {
	ID        string `json:"id" yaml:"id"`
	Name      string `json:"name" yaml:"name"`
	SortOrder int    `json:"sortOrder" yaml:"sortOrder"`
}

// AppConfig 应用全局配置
type AppConfig struct {
	Version              int       `json:"version" yaml:"version"`
	Theme                string    `json:"theme" yaml:"theme"`
	MinimizeToTray       bool      `json:"minimizeToTray" yaml:"minimizeToTray"`
	StartOnBoot          bool      `json:"startOnBoot" yaml:"startOnBoot"`
	AutoRestartGlobal    bool      `json:"autoRestartGlobal" yaml:"autoRestartGlobal"`
	GlobalMaxRestartCount int      `json:"globalMaxRestartCount" yaml:"globalMaxRestartCount"`
	Groups               []Group   `json:"groups" yaml:"groups"`
	Projects             []Project `json:"projects" yaml:"projects"`
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

// ProcessInfo 进程运行信息（给前端展示用）
type ProcessInfo struct {
	ProjectID    string  `json:"projectId"`
	Status       string  `json:"status"`
	PID          int     `json:"pid"`
	Port         int     `json:"port"`
	Uptime       int64   `json:"uptime"`       // 秒
	MemoryMB     float64 `json:"memoryMB"`
	CPUPercent   float64 `json:"cpuPercent"`
	RestartCount int     `json:"restartCount"`
}
