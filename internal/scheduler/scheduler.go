// Package scheduler 计划任务调度管理（Phase 4）
// 基于 robfig/cron/v3 实现，支持 cron 表达式定时启动目标项目，
// 超时自动终止子进程树，执行日志保留最近 50 条。
package scheduler

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"SliectLauncher/internal/config"
	"SliectLauncher/internal/model"
	"SliectLauncher/internal/process"

	"github.com/robfig/cron/v3"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const maxLogsPerTask = 50

// Manager 计划任务调度管理器
type Manager struct {
	mu      sync.Mutex
	cron    *cron.Cron
	cfg     *config.Manager
	procMgr *process.Manager
	ctx     context.Context

	logs    map[string][]model.SchedulerTaskLog // task ID -> 最近 50 条日志
	entries map[string]cron.EntryID             // task ID -> cron entry ID
}

// NewManager 创建调度管理器
func NewManager(cfg *config.Manager, procMgr *process.Manager) *Manager {
	return &Manager{
		cfg:     cfg,
		procMgr: procMgr,
		cron:    cron.New(cron.WithLocation(time.Local)), // 5 字段 cron，本地时区
		logs:    make(map[string][]model.SchedulerTaskLog),
		entries: make(map[string]cron.EntryID),
	}
}

// Start 启动调度器并加载所有已启用的任务
func (m *Manager) Start(ctx context.Context) {
	m.ctx = ctx
	m.cron.Start()

	for _, t := range m.cfg.GetTasks() {
		if t.Enabled {
			if err := m.addSchedule(t); err != nil {
				log.Printf("[Scheduler] 启动时加载任务 %s 失败: %v", t.Name, err)
			}
		}
	}
}

// Stop 停止调度器
func (m *Manager) Stop() {
	if m.cron != nil {
		m.cron.Stop()
	}
}

// AddTask 新增任务：写入配置并加入调度
func (m *Manager) AddTask(t model.SchedulerTask) error {
	if err := m.cfg.AddTask(t); err != nil {
		return err
	}
	if t.Enabled {
		if err := m.addSchedule(t); err != nil {
			return fmt.Errorf("任务已保存但调度失败: %w", err)
		}
	}
	return nil
}

// UpdateTask 更新任务：写入配置并重建调度
func (m *Manager) UpdateTask(t model.SchedulerTask) error {
	if err := m.cfg.UpdateTask(t); err != nil {
		return err
	}
	// 先移除旧调度
	m.removeSchedule(t.ID)
	// 若启用则重新加入
	if t.Enabled {
		if err := m.addSchedule(t); err != nil {
			return fmt.Errorf("任务已更新但调度失败: %w", err)
		}
	}
	return nil
}

// DeleteTask 删除任务：移除调度并从配置删除
func (m *Manager) DeleteTask(id string) error {
	m.removeSchedule(id)
	m.mu.Lock()
	delete(m.logs, id)
	m.mu.Unlock()
	return m.cfg.DeleteTask(id)
}

// RunTaskNow 立即执行一次任务（不影响 cron 调度）
func (m *Manager) RunTaskNow(id string) error {
	t := m.cfg.GetTask(id)
	if t == nil {
		return fmt.Errorf("任务 '%s' 不存在", id)
	}
	go m.executeTask(*t)
	return nil
}

// GetLogs 获取任务最近的执行日志（最多 50 条，按时间升序）
func (m *Manager) GetLogs(taskID string) []model.SchedulerTaskLog {
	m.mu.Lock()
	defer m.mu.Unlock()
	logs := m.logs[taskID]
	result := make([]model.SchedulerTaskLog, len(logs))
	copy(result, logs)
	return result
}

// addSchedule 将任务加入 cron 调度
func (m *Manager) addSchedule(t model.SchedulerTask) error {
	entryID, err := m.cron.AddFunc(t.CronExpr, func() {
		// 每次触发都从配置重新读取最新任务定义（防止 cron 闭包捕获旧值）
		latest := m.cfg.GetTask(t.ID)
		if latest == nil {
			return
		}
		m.executeTask(*latest)
	})
	if err != nil {
		return fmt.Errorf("无效的 cron 表达式 '%s': %w", t.CronExpr, err)
	}
	m.mu.Lock()
	m.entries[t.ID] = entryID
	m.mu.Unlock()
	return nil
}

// removeSchedule 移除任务的 cron 调度
func (m *Manager) removeSchedule(taskID string) {
	m.mu.Lock()
	entryID, ok := m.entries[taskID]
	if ok {
		m.cron.Remove(entryID)
		delete(m.entries, taskID)
	}
	m.mu.Unlock()
}

// executeTask 执行单个任务实例
func (m *Manager) executeTask(t model.SchedulerTask) {
	start := time.Now()
	startMs := start.UnixMilli()

	// 写入"运行中"日志
	m.appendLog(model.SchedulerTaskLog{
		TaskID:    t.ID,
		StartedAt: startMs,
		EndedAt:   0,
		Status:    "running",
		Message:   fmt.Sprintf("任务「%s」开始执行", t.Name),
	})
	m.cfg.SetTaskRuntimeState(t.ID, "running", startMs, 0)
	m.emitEvent("scheduler:started", map[string]interface{}{
		"taskId": t.ID, "name": t.Name, "time": startMs,
	})

	// 获取目标项目
	project := m.cfg.GetProject(t.ProjectID)
	if project == nil {
		m.finishTask(t, start, "failed", fmt.Sprintf("目标项目 '%s' 不存在", t.ProjectID))
		return
	}

	// 检查项目是否已在运行
	info := m.procMgr.GetProcessInfo(t.ProjectID)
	if info.Status == model.StatusRunning {
		m.finishTask(t, start, "skipped", fmt.Sprintf("项目「%s」已在运行，跳过启动", project.Name))
		return
	}

	// 启动项目
	if err := m.procMgr.StartProject(t.ProjectID); err != nil {
		m.finishTask(t, start, "failed", fmt.Sprintf("启动失败: %v", err))
		return
	}

	// 等待 2 秒确认进程稳定
	time.Sleep(2 * time.Second)
	info = m.procMgr.GetProcessInfo(t.ProjectID)
	if info.Status != model.StatusRunning {
		m.finishTask(t, start, "failed", fmt.Sprintf("进程启动后未保持运行（状态: %s）", info.Status))
		return
	}

	// timeout = 0 → fire-and-forget，立即标记成功
	if t.Timeout <= 0 {
		m.finishTask(t, start, "success", fmt.Sprintf("已启动项目「%s」(PID: %d)", project.Name, info.PID))
		return
	}

	// timeout > 0 → 轮询等待进程退出或超时
	deadline := time.Now().Add(time.Duration(t.Timeout) * time.Second)
	remaining := time.Until(deadline)
	if remaining <= 0 {
		// 已超时
		m.killProjectTask(t, project.Name, info.PID, "进程启动后立即超时")
		return
	}
	timeoutCh := time.After(remaining)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			cur := m.procMgr.GetProcessInfo(t.ProjectID)
			if cur.Status != model.StatusRunning {
				if cur.Status == model.StatusCrashed {
					m.finishTask(t, start, "failed", fmt.Sprintf("项目「%s」已崩溃退出", project.Name))
				} else {
					m.finishTask(t, start, "success", fmt.Sprintf("项目「%s」已正常退出", project.Name))
				}
				return
			}
		case <-timeoutCh:
			// 超时，强制终止
			cur := m.procMgr.GetProcessInfo(t.ProjectID)
			if cur.Status == model.StatusRunning {
				m.killProjectTask(t, project.Name, cur.PID,
					fmt.Sprintf("进程超时运行 %d 秒，已强制终止", t.Timeout))
			} else {
				m.finishTask(t, start, "success", "进程在超时前已退出")
			}
			return
		}
	}
}

// killProjectTask 终止被任务调度的进程并标记为 timeout
func (m *Manager) killProjectTask(t model.SchedulerTask, projectName string, pid int, msg string) {
	if pid > 0 {
		if err := m.procMgr.KillProcessByPID(pid); err != nil {
			log.Printf("[Scheduler] 终止进程 %d 失败: %v", pid, err)
			msg = fmt.Sprintf("%s（终止失败: %v）", msg, err)
		}
	}
	start := time.UnixMilli(t.LastRunAt)
	if start.IsZero() {
		start = time.Now()
	}
	m.finishTask(t, start, "timeout", msg)
}

// finishTask 标记任务结束并写入日志
func (m *Manager) finishTask(t model.SchedulerTask, start time.Time, status string, message string) {
	end := time.Now()
	duration := end.Sub(start).Milliseconds()
	startMs := start.UnixMilli()

	// 更新运行时状态
	m.cfg.SetTaskRuntimeState(t.ID, status, startMs, duration)

	// 写入结束日志
	m.appendLog(model.SchedulerTaskLog{
		TaskID:    t.ID,
		StartedAt: startMs,
		EndedAt:   end.UnixMilli(),
		Status:    status,
		Message:   message,
		Duration:  duration,
	})

	// 推送事件
	m.emitEvent("scheduler:completed", map[string]interface{}{
		"taskId":   t.ID,
		"name":     t.Name,
		"status":   status,
		"message":  message,
		"duration": duration,
		"time":     end.UnixMilli(),
	})

	log.Printf("[Scheduler] 任务「%s」完成: %s (%s, %dms) - %s",
		t.Name, status, t.CronExpr, duration, message)
}

// appendLog 追加任务执行日志，保留最近 50 条
func (m *Manager) appendLog(entry model.SchedulerTaskLog) {
	m.mu.Lock()
	defer m.mu.Unlock()
	logs := m.logs[entry.TaskID]
	// 若首条是 running 且新增也是 running（重复触发），更新而非追加
	if len(logs) > 0 {
		last := &logs[len(logs)-1]
		if last.Status == "running" && entry.Status == "running" {
			*last = entry
			return
		}
	}
	logs = append(logs, entry)
	if len(logs) > maxLogsPerTask {
		logs = logs[len(logs)-maxLogsPerTask:]
	}
	m.logs[entry.TaskID] = logs
}

// emitEvent 推送 Wails 事件到前端
func (m *Manager) emitEvent(name string, data interface{}) {
	if m.ctx == nil {
		return
	}
	wailsRuntime.EventsEmit(m.ctx, name, data)
}
