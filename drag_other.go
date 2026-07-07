//go:build !windows

package main

// startWindowDragNative 非 Windows 平台空实现（依赖 CSS -webkit-app-region: drag）
func startWindowDragNative() {}
