//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// webview2InstallPaths 存放 WebView2 运行时可能的安装路径
var webview2InstallPaths = []string{
	`C:\Program Files (x86)\Microsoft\EdgeWebView\Application`,
	`C:\Program Files\Microsoft\EdgeWebView\Application`,
}

// isWebView2Installed 检测 WebView2 Runtime 是否已安装。
// 综合注册表、文件系统两种方式，降低误报。
func isWebView2Installed() bool {
	if checkWebView2Registry() {
		return true
	}
	return checkWebView2Files()
}

// checkWebView2Registry 通过注册表检测 WebView2 Runtime。
func checkWebView2Registry() bool {
	const guid = "{F3017226-FE2A-5C33-93D2-6904E4A5D9D3}"
	checks := []struct {
		root registry.Key
		path string
		val  string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\EdgeUpdate\Clients\` + guid, "pv"},
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\` + guid, "pv"},
		{registry.CURRENT_USER, `SOFTWARE\Microsoft\EdgeUpdate\Clients\` + guid, "pv"},
		{registry.CURRENT_USER, `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\` + guid, "pv"},
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge WebView2 Runtime`, "DisplayName"},
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge WebView2 Runtime`, "DisplayName"},
	}

	for _, c := range checks {
		k, err := registry.OpenKey(c.root, c.path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		v, _, err := k.GetStringValue(c.val)
		k.Close()
		if err == nil && strings.TrimSpace(v) != "" {
			return true
		}
	}
	return false
}

// checkWebView2Files 通过文件系统检测 WebView2 Runtime 是否存在。
func checkWebView2Files() bool {
	for _, base := range webview2InstallPaths {
		if _, err := os.Stat(base); err != nil {
			continue
		}
		found := false
		_ = filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			name := strings.ToLower(info.Name())
			if name == "msedgewebview2.exe" || name == "ebwebview.dll" {
				found = true
				return filepath.SkipDir
			}
			return nil
		})
		if found {
			return true
		}
	}
	return false
}

// isInteractiveDesktopSession 粗略检测是否运行在交互式桌面会话中。
// 主要排除服务/无头会话，不能作为绝对依据。
func isInteractiveDesktopSession() bool {
	basePaths := []string{
		`C:\Windows\System32\tasklist.exe`,
		`C:\Windows\SysWOW64\tasklist.exe`,
	}
	for _, p := range basePaths {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if isExplorerRunning(p) {
			return true
		}
	}
	return false
}

func isExplorerRunning(tasklistPath string) bool {
	// 使用 tasklist 判断是否有 explorer.exe 在运行
	cmd := exec.Command(tasklistPath, "/fi", "imagename eq explorer.exe", "/fo", "csv", "/nh")
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), "explorer")
}
