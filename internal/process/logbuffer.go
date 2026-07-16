package process

import (
	"sync"
	"time"

	"SliectLauncher/internal/model"
)

const defaultBufferSize = 500

// LogBuffer 线程安全的环形日志缓冲区
type LogBuffer struct {
	mu         sync.RWMutex
	entries    []model.LogEntry
	head       int
	count      int
	size       int
	totalStats map[string]int // 累计级别统计（不随缓冲区滚动而丢失）
}

// NewLogBuffer 创建指定容量的环形缓冲区
func NewLogBuffer(size int) *LogBuffer {
	if size <= 0 {
		size = defaultBufferSize
	}
	return &LogBuffer{
		entries:    make([]model.LogEntry, size),
		size:       size,
		totalStats: make(map[string]int),
	}
}

// Add 添加一条日志到缓冲区
func (b *LogBuffer) Add(entry model.LogEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if entry.Timestamp == 0 {
		entry.Timestamp = time.Now().UnixMilli()
	}

	// 累计级别统计（不受环形缓冲区滚动影响）
	level := entry.Level
	if level == "" {
		level = "info"
	}
	b.totalStats[level]++

	b.entries[b.head] = entry
	b.head = (b.head + 1) % b.size
	if b.count < b.size {
		b.count++
	}
}

// GetStats 返回累计级别统计（从启动以来的真实总数，不随缓冲区滚动丢失）
func (b *LogBuffer) GetStats() map[string]int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	result := make(map[string]int, len(b.totalStats))
	for k, v := range b.totalStats {
		result[k] = v
	}
	return result
}

// GetRecent 获取最近 N 条日志（可按项目 ID 过滤）
func (b *LogBuffer) GetRecent(n int, projectID string) []model.LogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if n <= 0 || n > b.count {
		n = b.count
	}

	var result []model.LogEntry
	// 从最新的往回遍历
	for i := 0; i < b.count && len(result) < n; i++ {
		idx := (b.head - 1 - i + b.size) % b.size
		entry := b.entries[idx]
		if projectID == "" || entry.ProjectID == projectID {
			result = append(result, entry)
		}
	}

	// 反转为时间正序
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}

	return result
}

// Clear 清空指定项目的日志（projectID 为空则清空全部）
func (b *LogBuffer) Clear(projectID string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if projectID == "" {
		b.entries = make([]model.LogEntry, b.size)
		b.head = 0
		b.count = 0
		return
	}

	// 重建缓冲区，排除指定项目
	var kept []model.LogEntry
	for i := 0; i < b.count; i++ {
		idx := (b.head - b.count + i + b.size) % b.size
		if b.entries[idx].ProjectID != projectID {
			kept = append(kept, b.entries[idx])
		}
	}

	b.entries = make([]model.LogEntry, b.size)
	b.head = 0
	b.count = 0
	for _, e := range kept {
		b.entries[b.head] = e
		b.head = (b.head + 1) % b.size
		b.count++
	}
}
