// Package portmgr 端口占用管理（Phase 4）
// 列出所有 LISTEN 端口及对应进程，支持一键 taskkill 释放。
package portmgr

import (
	"context"
	"fmt"
	"sort"

	"SliectLauncher/internal/model"
	"SliectLauncher/internal/process"

	"github.com/shirou/gopsutil/v4/net"
	goprocess "github.com/shirou/gopsutil/v4/process"
)

// Manager 端口管理器
type Manager struct {
	procMgr *process.Manager
}

// NewManager 创建端口管理器
func NewManager(procMgr *process.Manager) *Manager {
	return &Manager{procMgr: procMgr}
}

// ListPorts 列出所有被占用端口及进程信息（去重，按端口号升序）
func (m *Manager) ListPorts() ([]model.PortInfo, error) {
	ctx := context.Background()

	// 并发获取 TCP / UDP 连接
	tcpConns, err := net.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return nil, fmt.Errorf("获取 TCP 连接失败: %w", err)
	}
	udpConns, _ := net.ConnectionsWithContext(ctx, "udp")

	// 构建 PID -> 进程名映射（一次拉取所有进程，避免逐个查询）
	pidNameMap := make(map[int]string)
	if procs, err := goprocess.Processes(); err == nil {
		for _, p := range procs {
			if name, err := p.Name(); err == nil && name != "" {
				pidNameMap[int(p.Pid)] = name
			}
		}
	}

	var result []model.PortInfo
	seen := make(map[int]bool) // 按端口去重（同端口只保留一条 LISTEN 记录）

	// TCP LISTEN
	for _, c := range tcpConns {
		if c.Status != "LISTEN" && c.Status != "BOUND" {
			continue
		}
		port := int(c.Laddr.Port)
		if port == 0 || seen[port] {
			continue
		}
		seen[port] = true
		name := pidNameMap[int(c.Pid)]
		if name == "" {
			name = "unknown"
		}
		result = append(result, model.PortInfo{
			Port:        port,
			Protocol:    "tcp",
			Status:      c.Status,
			PID:         int(c.Pid),
			ProcessName: name,
			LocalAddr:   c.Laddr.IP,
		})
	}

	// UDP（无连接状态，仅显示绑定）
	for _, c := range udpConns {
		port := int(c.Laddr.Port)
		if port == 0 || seen[port] {
			continue
		}
		seen[port] = true
		name := pidNameMap[int(c.Pid)]
		if name == "" {
			name = "unknown"
		}
		result = append(result, model.PortInfo{
			Port:        port,
			Protocol:    "udp",
			Status:      "LISTEN",
			PID:         int(c.Pid),
			ProcessName: name,
			LocalAddr:   c.Laddr.IP,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Port < result[j].Port
	})
	return result, nil
}

// KillPort 终止占用指定端口的进程（复用 process.Manager 的 taskkill 逻辑）
func (m *Manager) KillPort(port int) error {
	if m.procMgr == nil {
		return fmt.Errorf("进程管理器未初始化")
	}
	if port <= 0 || port > 65535 {
		return fmt.Errorf("无效的端口号: %d", port)
	}
	pid, name := m.procMgr.CheckPortInUse(port)
	if pid <= 0 {
		return fmt.Errorf("端口 %d 未被占用", port)
	}
	if err := m.procMgr.KillProcessByPID(pid); err != nil {
		return fmt.Errorf("终止进程 %s (PID: %d) 失败: %w", name, pid, err)
	}
	return nil
}
