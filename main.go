package main

import (
	"embed"
	"log"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// isServerMode 判断当前是否运行在服务器/虚拟化环境中。
// 支持显式环境变量 SLIECT_SERVER_MODE=1 或 SLIECT_NO_SPLASH=1。
func isServerMode() bool {
	v := os.Getenv("SLIECT_SERVER_MODE")
	if strings.ToLower(v) == "1" || strings.ToLower(v) == "true" {
		return true
	}
	v = os.Getenv("SLIECT_NO_SPLASH")
	if strings.ToLower(v) == "1" || strings.ToLower(v) == "true" {
		return true
	}
	return false
}

// setupWebView2ForServer 在服务器环境中为 WebView2 设置兼容性参数：禁用 GPU 加速、
// 禁用渲染器代码完整性检查，并尽量使用软件渲染，避免虚拟服务器/远程桌面无 GPU 时崩溃或白屏。
func setupWebView2ForServer() {
	args := []string{
		"--disable-gpu",
		"--disable-gpu-compositing",
		"--in-process-gpu",
		"--disable-software-rasterizer",
		"--disable-features=CalculateWindowOcclusion",
	}
	// 允许用户追加自定义参数
	if existing := os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"); existing != "" {
		args = append(args, existing)
	}
	os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", strings.Join(args, " "))
	log.Println("[ServerMode] WebView2 args:", os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"))
}

// checkRuntimeEnvironment 在启动 splash 前检测 WebView2 与桌面环境。
// 如果环境检测未通过，会弹出警告框让用户选择继续启动或退出，不再强制阻断。
func checkRuntimeEnvironment() bool {
	log.Println("[EnvCheck] 正在检测 WebView2 Runtime...")
	if isWebView2Installed() {
		log.Println("[EnvCheck] WebView2 Runtime 已安装")
		return true
	}

	log.Println("[EnvCheck] 未检测到 WebView2 Runtime")
	if !isInteractiveDesktopSession() {
		log.Println("[EnvCheck] 非交互式桌面会话")
		showNativeMessage(
			"Sliect Launcher — 环境不满足",
			"当前不是交互式桌面会话，且未检测到 WebView2 Runtime。\n"+
				"请在已安装 WebView2 Runtime 的 Windows 桌面环境中运行。",
			true,
		)
		return false
	}

	// 检测不到时给出警告，但允许用户继续尝试启动（避免误报导致无法使用）
	cont := showNativeConfirm(
		"Sliect Launcher — 未检测到 WebView2 Runtime",
		"未能确认 WebView2 Runtime 已安装，Sliect Launcher 可能无法正常启动。\n"+
			"是否继续尝试启动？\n\n"+
			"建议：在普通 Windows 桌面环境或已安装 WebView2 Runtime 的容器中运行。\n"+
			"若点击“否”，程序将退出。",
		true,
	)
	if !cont {
		return false
	}
	log.Println("[EnvCheck] 用户选择继续启动")
	return true
}

func main() {
	serverMode := isServerMode()
	if serverMode {
		log.Println("[ServerMode] 检测到服务器/虚拟化模式，启动画面与 GPU 将降级处理")
		setupWebView2ForServer()
	}

	if !serverMode {
		showSplash() // GDI+ 原生启动画面，先显示出来，避免被环境检测阻塞
	}

	// 在启动画面上显示环境检测步骤，不阻塞窗口弹出
	updateSplashStatus("正在检测运行环境...")
	updateSplashProgress(0.02)
	recordStartupProgress(0.02)

	// 启动前环境检测；服务器模式也检测，因为 WebView2 是硬需求。
	// 设置 SLIECT_SKIP_ENV_CHECK=1 可跳过检测（主要用于 CI/构建环境）。
	if os.Getenv("SLIECT_SKIP_ENV_CHECK") != "1" {
		if !checkRuntimeEnvironment() {
			closeSplash()
			return
		}
	} else {
		log.Println("[EnvCheck] 已跳过环境检测（SLIECT_SKIP_ENV_CHECK=1）")
	}

	updateSplashStatus("正在初始化主窗口...")
	updateSplashProgress(0.03)
	recordStartupProgress(0.03)

	// 启动看门狗：20 秒内 startup() 未完成则强制关闭启动画面。
	// 如果期间进度还在推进，则重置计时器，连续 20 秒无进展才报超时。
	go func() {
		timeout := 20 * time.Second
		deadline := time.Now().Add(timeout)
		var lastProgress uint64
		for {
			now := time.Now()
			if now.After(deadline) {
				log.Println("[Watchdog] startup 20s timeout, force closing splash")
				closeSplash()
				showNativeMessage(
					"Sliect Launcher — 启动初始化超时",
					"程序在 20 秒内未能完成初始化（虚拟服务器/远程桌面常见）。\n"+
						"启动画面已强制关闭，但如果主窗口仍未出现，可能是 WebView2 环境或 GPU 不支持。\n"+
						"建议检查：1) 是否安装 WebView2 Runtime；2) 是否为完整桌面会话；3) 尝试设置 SLIECT_SERVER_MODE=1。",
					true,
				)
				return
			}

			// 如果进度有推进或最近 5 秒有活动，重置死线
			currentProgress := startupProgress.Load()
			lastActivity := startupLastActivity.Load()
			if currentProgress != lastProgress || (now.UnixMilli()-lastActivity) < 5000 {
				if currentProgress != lastProgress {
					log.Printf("[Watchdog] progress moved to %.4f, reset timer", float64(currentProgress)/1e6)
					lastProgress = currentProgress
				} else {
					log.Println("[Watchdog] recent activity detected, reset timer")
				}
				deadline = now.Add(timeout)
			}

			time.Sleep(1 * time.Second)
		}
	}()

	app := NewApp()

	err := wails.Run(&options.App{
		Title:       "Sliect Launcher",
		StartHidden: true, // 启动画面关闭后由 startup() 显示
		Width:       1200,
		Height:      800,
		MinWidth:    900,
		MinHeight:   600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 15, B: 18, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:                false,
			WindowIsTranslucent:                 false,
			DisableWindowIcon:                   false,
			WebviewGpuIsDisabled:                serverMode,
			WebviewDisableRendererCodeIntegrity: serverMode,
		},
	})

	if err != nil {
		println("启动失败:", err.Error())
		showNativeMessage(
			"Sliect Launcher — 启动失败",
			"应用程序启动失败：\n\n"+err.Error()+"\n\n"+
				"常见原因：虚拟服务器缺少 WebView2 Runtime、GPU 加速不可用、或桌面会话不完整。\n"+
				"请在普通 Windows 桌面环境或已安装 WebView2 Runtime 的容器中运行。\n"+
				"在服务器/远程桌面中可尝试设置环境变量 SLIECT_SERVER_MODE=1 后重新启动。",
			true,
		)
	}
}
