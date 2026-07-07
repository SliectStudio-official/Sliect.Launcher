package config

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"SliectLauncher/internal/model"

	"gopkg.in/yaml.v3"
)

// Manager 配置管理器，负责 YAML 配置的读写和持久化
type Manager struct {
	mu       sync.RWMutex
	filePath string
	config   *model.AppConfig
}

// NewManager 创建配置管理器，配置文件路径为 %APPDATA%/SliectLauncher/config.yaml
func NewManager() (*Manager, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		home, _ := os.UserHomeDir()
		appData = filepath.Join(home, "AppData", "Roaming")
	}

	dir := filepath.Join(appData, "SliectLauncher")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建配置目录失败: %w", err)
	}

	m := &Manager{
		filePath: filepath.Join(dir, "config.yaml"),
	}

	if err := m.load(); err != nil {
		return nil, err
	}

	return m, nil
}

// GetConfig 获取当前配置的副本
func (m *Manager) GetConfig() model.AppConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp := *m.config
	return cp
}

// GetProjects 获取所有项目
func (m *Manager) GetProjects() []model.Project {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]model.Project, len(m.config.Projects))
	copy(result, m.config.Projects)
	return result
}

// GetGroups 获取所有分组
func (m *Manager) GetGroups() []model.Group {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]model.Group, len(m.config.Groups))
	copy(result, m.config.Groups)
	return result
}

// GetProject 按 ID 获取单个项目
func (m *Manager) GetProject(id string) *model.Project {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for i := range m.config.Projects {
		if m.config.Projects[i].ID == id {
			p := m.config.Projects[i]
			return &p
		}
	}
	return nil
}

// AddProject 添加项目
func (m *Manager) AddProject(p model.Project) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 检查 ID 唯一
	for _, existing := range m.config.Projects {
		if existing.ID == p.ID {
			return fmt.Errorf("项目 ID '%s' 已存在", p.ID)
		}
	}

	p.Status = model.StatusStopped
	m.config.Projects = append(m.config.Projects, p)
	return m.save()
}

// UpdateProject 更新项目
func (m *Manager) UpdateProject(p model.Project) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.config.Projects {
		if m.config.Projects[i].ID == p.ID {
			// 保留运行时状态
			p.Status = m.config.Projects[i].Status
			p.PID = m.config.Projects[i].PID
			p.StartedAt = m.config.Projects[i].StartedAt
			p.RestartCount = m.config.Projects[i].RestartCount
			m.config.Projects[i] = p
			return m.save()
		}
	}
	return fmt.Errorf("项目 '%s' 不存在", p.ID)
}

// DeleteProject 删除项目
func (m *Manager) DeleteProject(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.config.Projects {
		if m.config.Projects[i].ID == id {
			m.config.Projects = append(m.config.Projects[:i], m.config.Projects[i+1:]...)
			return m.save()
		}
	}
	return fmt.Errorf("项目 '%s' 不存在", id)
}

// AddGroup 添加分组
func (m *Manager) AddGroup(g model.Group) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, existing := range m.config.Groups {
		if existing.ID == g.ID {
			return fmt.Errorf("分组 ID '%s' 已存在", g.ID)
		}
	}

	m.config.Groups = append(m.config.Groups, g)
	return m.save()
}

// UpdateGroup 更新分组
func (m *Manager) UpdateGroup(g model.Group) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.config.Groups {
		if m.config.Groups[i].ID == g.ID {
			m.config.Groups[i] = g
			return m.save()
		}
	}
	return fmt.Errorf("分组 '%s' 不存在", g.ID)
}

// DeleteGroup 删除分组（不删除组内项目，项目的 GroupID 清空）
func (m *Manager) DeleteGroup(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	found := false
	for i := range m.config.Groups {
		if m.config.Groups[i].ID == id {
			m.config.Groups = append(m.config.Groups[:i], m.config.Groups[i+1:]...)
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("分组 '%s' 不存在", id)
	}

	// 清空该组下项目的 GroupID
	for i := range m.config.Projects {
		if m.config.Projects[i].GroupID == id {
			m.config.Projects[i].GroupID = ""
		}
	}

	return m.save()
}

// UpdateGlobalSettings 更新全局设置
func (m *Manager) UpdateGlobalSettings(theme string, minimizeToTray, startOnBoot, autoRestart bool, globalMaxRestartCount int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if theme != "" {
		m.config.Theme = theme
	}
	m.config.MinimizeToTray = minimizeToTray
	m.config.StartOnBoot = startOnBoot
	m.config.AutoRestartGlobal = autoRestart
	m.config.GlobalMaxRestartCount = globalMaxRestartCount
	return m.save()
}

// SetProjectStatus 更新项目的运行时状态（不持久化到磁盘）
func (m *Manager) SetProjectStatus(id string, status string, pid int) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.config.Projects {
		if m.config.Projects[i].ID == id {
			m.config.Projects[i].Status = status
			m.config.Projects[i].PID = pid
			return
		}
	}
}

// SetProjectPort 更新项目运行时检测到的端口（不持久化到磁盘）
func (m *Manager) SetProjectPort(id string, port int) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.config.Projects {
		if m.config.Projects[i].ID == id {
			if m.config.Projects[i].Port != port {
				m.config.Projects[i].Port = port
			}
			return
		}
	}
}

// GetProjectPort 获取项目当前端口（配置端口或自动检测端口）
func (m *Manager) GetProjectPort(id string) int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, p := range m.config.Projects {
		if p.ID == id {
			return p.Port
		}
	}
	return 0
}

// load 从磁盘加载配置
func (m *Manager) load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			// 配置文件不存在，使用默认配置
			m.config = m.defaultConfig()
			return m.save()
		}
		return fmt.Errorf("读取配置文件失败: %w", err)
	}

	var cfg model.AppConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("解析配置文件失败: %w", err)
	}

	// 确保所有项目状态初始化为 stopped
	for i := range cfg.Projects {
		cfg.Projects[i].Status = model.StatusStopped
	}

	m.config = &cfg
	return nil
}

// save 将配置写入磁盘（调用者必须持有写锁）
func (m *Manager) save() error {
	data, err := yaml.Marshal(m.config)
	if err != nil {
		return fmt.Errorf("序列化配置失败: %w", err)
	}

	if err := os.WriteFile(m.filePath, data, 0644); err != nil {
		return fmt.Errorf("写入配置文件失败: %w", err)
	}
	return nil
}

// defaultConfig 返回默认配置
func (m *Manager) defaultConfig() *model.AppConfig {
	return &model.AppConfig{
		Version:              1,
		Theme:                "dark",
		MinimizeToTray:       true,
		StartOnBoot:          false,
		AutoRestartGlobal:    false,
		GlobalMaxRestartCount: 5,
		Groups:               []model.Group{},
		Projects:             []model.Project{},
	}
}
