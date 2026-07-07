//go:build windows

package main

import (
	"syscall"
)

var (
	user32             = syscall.NewLazyDLL("user32.dll")
	procGetForeground  = user32.NewProc("GetForegroundWindow")
	procGetAncestor    = user32.NewProc("GetAncestor")
	procReleaseCapture = user32.NewProc("ReleaseCapture")
	procSendMessage    = user32.NewProc("SendMessageW")
)

const (
	wmSysCommand = 0x0112
	scMove       = 0xF010
	htCaption    = 0x02
	gaRoot       = 2 // GA_ROOT: 获取顶层窗口
)

// startWindowDragNative 通过 Windows API 触发原生窗口拖拽
// GetForegroundWindow 可能返回 WebView2 子窗口，需用 GetAncestor(GA_ROOT) 获取顶层 Wails 窗口
func startWindowDragNative() {
	hwnd, _, _ := procGetForeground.Call()
	if hwnd == 0 {
		return
	}
	// 获取顶层窗口（跳过 WebView2 子窗口层级）
	rootHwnd, _, _ := procGetAncestor.Call(hwnd, uintptr(gaRoot))
	if rootHwnd != 0 {
		hwnd = rootHwnd
	}
	procReleaseCapture.Call()
	procSendMessage.Call(hwnd, uintptr(wmSysCommand), uintptr(scMove+htCaption), uintptr(0))
}
