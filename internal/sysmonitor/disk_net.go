package sysmonitor

import (
	"context"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/net"
)

// ═══════════════════════════════════════════════════════
// Phase 2：磁盘 / 网络 IO 采集
// 不修改原有 SystemStats，新增独立结构与方法
// ═══════════════════════════════════════════════════════

// DiskUsage 磁盘分区使用情况
type DiskUsage struct {
	Path        string  `json:"path"`        // 挂载点（Windows: C:\）
	Device      string  `json:"device"`      // 设备名
	Fstype      string  `json:"fstype"`      // 文件系统类型
	Total       uint64  `json:"total"`       // 总容量（字节）
	Used        uint64  `json:"used"`        // 已用（字节）
	Free        uint64  `json:"free"`        // 可用（字节）
	UsedPercent float64 `json:"usedPercent"` // 使用率 %
}

// DiskIOStats 磁盘 IO 统计（含每秒速率）
type DiskIOStats struct {
	Name             string  `json:"name"`             // 磁盘名（Windows 下是物理盘符）
	ReadBytes        uint64  `json:"readBytes"`        // 累计读取字节
	WriteBytes       uint64  `json:"writeBytes"`       // 累计写入字节
	ReadBytesPerSec  float64 `json:"readBytesPerSec"`  // 每秒读取字节
	WriteBytesPerSec float64 `json:"writeBytesPerSec"` // 每秒写入字节
}

// NetIOStats 网络 IO 统计（含每秒速率）
type NetIOStats struct {
	Name              string  `json:"name"`              // 网卡名
	BytesSent         uint64  `json:"bytesSent"`         // 累计发送字节
	BytesRecv         uint64  `json:"bytesRecv"`         // 累计接收字节
	BytesSentPerSec   float64 `json:"bytesSentPerSec"`   // 每秒发送字节
	BytesRecvPerSec   float64 `json:"bytesRecvPerSec"`   // 每秒接收字节
	PacketsSent       uint64  `json:"packetsSent"`       // 累计发送包
	PacketsRecv       uint64  `json:"packetsRecv"`       // 累计接收包
}

// FullSystemStats 完整系统统计（嵌入原有 + 新增磁盘/网络）
type FullSystemStats struct {
	SystemStats              // 嵌入原有 CPU/内存字段
	Disks  []DiskUsage  `json:"disks"`
	DiskIO []DiskIOStats `json:"diskIO"`
	NetIO  []NetIOStats  `json:"netIO"`
}

// ── 速率计算状态 ──
// gopsutil 返回的是累计计数器，需对比上次采样计算每秒速率
type diskIOSample struct {
	readBytes  uint64
	writeBytes uint64
	time       time.Time
}

type netIOSample struct {
	bytesSent uint64
	bytesRecv uint64
	time      time.Time
}

var (
	diskIOLast   = make(map[string]diskIOSample)
	netIOLast    = make(map[string]netIOSample)
	ioStateMutex sync.Mutex
)

// GetDiskUsage 获取所有磁盘分区使用情况
// Windows 下会返回各盘符（C:\、D:\ 等）的使用情况
func GetDiskUsage() []DiskUsage {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	partitions, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		return []DiskUsage{}
	}

	var result []DiskUsage
	for _, p := range partitions {
		usage, err := disk.UsageWithContext(ctx, p.Mountpoint)
		if err != nil {
			continue
		}
		result = append(result, DiskUsage{
			Path:        p.Mountpoint,
			Device:      p.Device,
			Fstype:      p.Fstype,
			Total:       usage.Total,
			Used:        usage.Used,
			Free:        usage.Free,
			UsedPercent: usage.UsedPercent,
		})
	}
	return result
}

// GetDiskIOStats 获取磁盘 IO 统计（含每秒速率）
// 首次调用时速率字段为 0，后续调用基于上次采样计算
func GetDiskIOStats() []DiskIOStats {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	counters, err := disk.IOCountersWithContext(ctx)
	if err != nil {
		return []DiskIOStats{}
	}

	now := time.Now()
	ioStateMutex.Lock()
	defer ioStateMutex.Unlock()

	var result []DiskIOStats
	for _, c := range counters {
		entry := DiskIOStats{
			Name:       c.Name,
			ReadBytes:  c.ReadBytes,
			WriteBytes: c.WriteBytes,
		}

		if last, ok := diskIOLast[c.Name]; ok {
			dt := now.Sub(last.time).Seconds()
			if dt > 0 {
				entry.ReadBytesPerSec = float64(c.ReadBytes-last.readBytes) / dt
				entry.WriteBytesPerSec = float64(c.WriteBytes-last.writeBytes) / dt
				// 防止计数器回绕或异常跳变导致负值
				if entry.ReadBytesPerSec < 0 {
					entry.ReadBytesPerSec = 0
				}
				if entry.WriteBytesPerSec < 0 {
					entry.WriteBytesPerSec = 0
				}
			}
		}

		diskIOLast[c.Name] = diskIOSample{
			readBytes:  c.ReadBytes,
			writeBytes: c.WriteBytes,
			time:       now,
		}
		result = append(result, entry)
	}
	return result
}

// GetNetIOStats 获取网络 IO 统计（含每秒速率）
// 过滤掉回环和速率为 0 的无用网卡
func GetNetIOStats() []NetIOStats {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	counters, err := net.IOCountersWithContext(ctx, true)
	if err != nil {
		return []NetIOStats{}
	}

	now := time.Now()
	ioStateMutex.Lock()
	defer ioStateMutex.Unlock()

	var result []NetIOStats
	for _, c := range counters {
		// 过滤回环接口和空名
		if c.Name == "" || c.Name == "lo" {
			continue
		}

		entry := NetIOStats{
			Name:        c.Name,
			BytesSent:   c.BytesSent,
			BytesRecv:   c.BytesRecv,
			PacketsSent: c.PacketsSent,
			PacketsRecv: c.PacketsRecv,
		}

		if last, ok := netIOLast[c.Name]; ok {
			dt := now.Sub(last.time).Seconds()
			if dt > 0 {
				entry.BytesSentPerSec = float64(c.BytesSent-last.bytesSent) / dt
				entry.BytesRecvPerSec = float64(c.BytesRecv-last.bytesRecv) / dt
				if entry.BytesSentPerSec < 0 {
					entry.BytesSentPerSec = 0
				}
				if entry.BytesRecvPerSec < 0 {
					entry.BytesRecvPerSec = 0
				}
			}
		}

		netIOLast[c.Name] = netIOSample{
			bytesSent: c.BytesSent,
			bytesRecv: c.BytesRecv,
			time:      now,
		}
		result = append(result, entry)
	}
	return result
}

// GetFullSystemStats 一次性返回完整系统统计（CPU/内存 + 磁盘 + 网络）
// 供前端轮询调用，减少多次请求开销
func GetFullSystemStats() FullSystemStats {
	return FullSystemStats{
		SystemStats: GetSystemStats(),
		Disks:       GetDiskUsage(),
		DiskIO:      GetDiskIOStats(),
		NetIO:       GetNetIOStats(),
	}
}
