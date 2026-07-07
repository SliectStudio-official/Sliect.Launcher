package sysmonitor

import (
	"context"
	"runtime"
	"sort"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
)

// SystemStats 系统资源统计
type SystemStats struct {
	CPUPercent    float64 `json:"cpuPercent"`
	CPUCores      int     `json:"cpuCores"`
	MemTotal      uint64  `json:"memTotal"`      // 字节
	MemUsed       uint64  `json:"memUsed"`       // 字节
	MemPercent    float64 `json:"memPercent"`
	SwapTotal     uint64  `json:"swapTotal"`
	SwapUsed      uint64  `json:"swapUsed"`
	SwapPercent   float64 `json:"swapPercent"`
}

// ProcessEntry 进程信息
type ProcessEntry struct {
	PID        int32   `json:"pid"`
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpuPercent"`
	MemMB      float64 `json:"memMB"`
	MemPercent float64 `json:"memPercent"`
}

// TopProcesses 进程排行
type TopProcesses struct {
	ByCPU  []ProcessEntry `json:"byCpu"`
	ByMem  []ProcessEntry `json:"byMem"`
}

// GetSystemStats 获取系统资源统计
func GetSystemStats() SystemStats {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	stats := SystemStats{
		CPUCores: 0,
	}

	// CPU
	cores, _ := cpu.CountsWithContext(ctx, true)
	stats.CPUCores = cores

	pcts, err := cpu.PercentWithContext(ctx, 200*time.Millisecond, false)
	if err == nil && len(pcts) > 0 {
		stats.CPUPercent = pcts[0]
	}

	// 内存
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		stats.MemTotal = vm.Total
		stats.MemUsed = vm.Used
		stats.MemPercent = vm.UsedPercent
	}

	// 交换分区
	if sw, err := mem.SwapMemoryWithContext(ctx); err == nil {
		stats.SwapTotal = sw.Total
		stats.SwapUsed = sw.Used
		stats.SwapPercent = sw.UsedPercent
	}

	return stats
}

// GetTopProcesses 获取 Top N 进程（按 CPU 和内存排序）
func GetTopProcesses(n int) TopProcesses {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	procs, err := process.ProcessesWithContext(ctx)
	if err != nil || len(procs) == 0 {
		return TopProcesses{}
	}

	var entries []ProcessEntry
	for _, p := range procs {
		name, _ := p.NameWithContext(ctx)
		if name == "" {
			name = "unknown"
		}

		cpuPct, _ := p.CPUPercentWithContext(ctx)
		// CPUPercentWithContext 返回单核百分比(0-100/core)，除以核心数转为系统百分比
		numCPU := float64(runtime.NumCPU())
		if numCPU > 0 {
			cpuPct = cpuPct / numCPU
		}
		if cpuPct > 100 {
			cpuPct = 100
		}
		memInfo, _ := p.MemoryInfoWithContext(ctx)
		memPct, _ := p.MemoryPercentWithContext(ctx)

		var memMB float64
		if memInfo != nil {
			memMB = float64(memInfo.RSS) / 1024 / 1024
		}

		entries = append(entries, ProcessEntry{
			PID:        p.Pid,
			Name:       name,
			CPUPercent: cpuPct,
			MemMB:      memMB,
			MemPercent: float64(memPct),
		})
	}

	// 按 CPU 排序
	byCPU := make([]ProcessEntry, len(entries))
	copy(byCPU, entries)
	sort.Slice(byCPU, func(i, j int) bool { return byCPU[i].CPUPercent > byCPU[j].CPUPercent })
	if len(byCPU) > n {
		byCPU = byCPU[:n]
	}

	// 按内存排序
	byMem := make([]ProcessEntry, len(entries))
	copy(byMem, entries)
	sort.Slice(byMem, func(i, j int) bool { return byMem[i].MemMB > byMem[j].MemMB })
	if len(byMem) > n {
		byMem = byMem[:n]
	}

	return TopProcesses{ByCPU: byCPU, ByMem: byMem}
}
