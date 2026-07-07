package filebrowser

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"SliectLauncher/internal/model"
)

// Manager 文件浏览器（只读），用于项目表单内嵌的目录选择面板
type Manager struct{}

// NewManager 创建文件浏览器实例
func NewManager() *Manager {
	return &Manager{}
}

// ListDir 列出指定目录下的条目（目录在前，按名称排序）
// path 为空时返回逻辑驱动器列表（Windows: C:\ D:\ ...）
func (m *Manager) ListDir(path string) ([]model.DirEntry, error) {
	if path == "" {
		return listDrives(), nil
	}

	// 规范化路径：确保是绝对路径
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("路径无效: %v", err)
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("路径不存在: %s", absPath)
		}
		return nil, fmt.Errorf("无法访问路径: %v", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", absPath)
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, fmt.Errorf("读取目录失败: %v", err)
	}

	result := make([]model.DirEntry, 0, len(entries))
	for _, entry := range entries {
		// 跳过以 . 开头的隐藏文件/目录（.git .vscode 等）
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(absPath, entry.Name())
		result = append(result, model.DirEntry{
			Name:    entry.Name(),
			Path:    fullPath,
			IsDir:   entry.IsDir(),
			Size:    sizeOrZero(info),
			ModTime: info.ModTime().UnixMilli(),
		})
	}

	// 排序：目录在前，同类按名称升序（不区分大小写）
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir // 目录在前
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	return result, nil
}

// GetDirTree 获取目录树（仅文件夹），maxDepth 限制深度（0 表示仅根，<0 视为 2）
// 用于左栏树形导航，避免扫描过深导致卡顿
func (m *Manager) GetDirTree(root string, maxDepth int) (*model.DirNode, error) {
	if maxDepth < 0 {
		maxDepth = 2
	}

	absPath, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("路径无效: %v", err)
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return nil, fmt.Errorf("无法访问路径: %v", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", absPath)
	}

	rootName := filepath.Base(absPath)
	if rootName == "" || rootName == "." {
		rootName = absPath
	}
	rootNode := &model.DirNode{
		Name: rootName,
		Path: absPath,
	}
	m.buildDirTree(rootNode, maxDepth)
	return rootNode, nil
}

// buildDirTree 递归构建目录树
func (m *Manager) buildDirTree(node *model.DirNode, depth int) {
	if depth <= 0 {
		return
	}

	entries, err := os.ReadDir(node.Path)
	if err != nil {
		return
	}

	// 先收集子目录，避免在循环中 append 影响遍历
	var subDirs []model.DirEntry
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		subDirs = append(subDirs, model.DirEntry{
			Name:  entry.Name(),
			Path:  filepath.Join(node.Path, entry.Name()),
			IsDir: true,
		})
	}

	// 按名称排序
	sort.SliceStable(subDirs, func(i, j int) bool {
		return strings.ToLower(subDirs[i].Name) < strings.ToLower(subDirs[j].Name)
	})

	// 限制每层最多 200 个子目录，避免扫描巨型目录卡顿
	if len(subDirs) > 200 {
		subDirs = subDirs[:200]
	}

	for _, d := range subDirs {
		child := &model.DirNode{
			Name: d.Name,
			Path: d.Path,
		}
		m.buildDirTree(child, depth-1)
		node.Children = append(node.Children, child)
	}
}

// listDrives 列出 Windows 逻辑驱动器
func listDrives() []model.DirEntry {
	var drives []model.DirEntry
	for c := 'A'; c <= 'Z'; c++ {
		path := string(c) + `:\`
		if _, err := os.Stat(path); err == nil {
			drives = append(drives, model.DirEntry{
				Name:  string(c) + ":",
				Path:  path,
				IsDir: true,
			})
		}
	}
	return drives
}

// sizeOrZero 安全获取文件大小
func sizeOrZero(info os.FileInfo) int64 {
	if info == nil {
		return 0
	}
	if info.IsDir() {
		return 0
	}
	return info.Size()
}
