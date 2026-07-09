//go:build windows

package main

/*
#include <windows.h>
#include <stdlib.h>

// ── splash_native.c 导出的辅助函数 ──
extern int splashGdipInit(void);
extern void* splashCreateGraphics(HDC hdc);
extern void splashDeleteGraphics(void *g);
extern void splashSetQuality(void *g);
extern void* splashCreateSolidBrush(DWORD argb);
extern void splashDeleteBrush(void *b);
extern void splashFillRect(void *g, void *brush, float x, float y, float w, float h);
extern void* splashLoadImage(const void *data, UINT size);
extern void splashDisposeImage(void *img);
extern void splashGetImageSize(void *img, UINT *w, UINT *h);
extern void splashDrawImageRect(void *g, void *img, int dx, int dy, int dw, int dh, int sx, int sy, int sw, int sh);
extern void* splashCreateFont(const WCHAR *familyName, float emSize, int bold);
extern void splashDeleteFont(void *font);
extern void* splashCreateStringFormat(int hAlign, int vAlign);
extern void splashDeleteStringFormat(void *fmt);
extern void splashDrawString(void *g, const WCHAR *text, int len, void *font, float rx, float ry, float rw, float rh, void *fmt, void *brush);
extern void splashCacheImages(const void *mlD, UINT mlS, const void *mdD, UINT mdS, const void *slD, UINT slS, const void *sdD, UINT sdS);
extern void splashGetMainLogo(int dark, void **img, UINT *w, UINT *h);
extern void splashGetStudioLogo(int dark, void **img, UINT *w, UINT *h);
extern void splashFreeImages(void);
extern void splashLogStr(const char *msg);

// WNDPROC trampoline
extern LRESULT CALLBACK splashWndProcC(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

// MinGW-w64 可能未声明
extern UINT GetDpiForSystem(void);
*/
import "C"

import (
	_ "embed"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

// Version 格式: 大版本.yyMMdd.HHmm（大版本手动管理，详细版本为构建时间）
// 可通过 -ldflags "-X main.Version=x.y.yyMMdd.HHmm" 在编译时注入
var Version = "2.1.260709.1342"

// ======================== 嵌入资源 ========================

//go:embed files/BootLogo_LogoLight.png
var bootLogoLightPNG []byte

//go:embed files/BootLogo_LogoDark.png
var bootLogoDarkPNG []byte

//go:embed files/SliectStudio_LogoLight.png
var studioLogoLightPNG []byte

//go:embed files/SliectStudio_LogoDark.png
var studioLogoDarkPNG []byte

// ======================== 常量 ========================

const (
	splashFadeOutFrames = 12

	splashClassName = "SliectSplashWnd"
	wmCloseSplash   = C.WM_USER + 1

	timerAnimID    = 1
	timerTopmostID = 2 // 周期性重设 TOPMOST，防止 Wails 窗口覆盖
)

// ======================== 全局状态 ========================

var (
	splashMu         sync.RWMutex
	splashStatusText string
	splashProgress   float32 // 0.0 ~ 1.0
	splashDone       chan struct{}
	splashCreatedAt  time.Time
	splashVisible    atomic.Bool // ShowWindow 后设为 true
)

type splash struct {
	hwnd       C.HWND
	w, h       int
	dpiScale   float64
	dark       bool
	timerID    C.UINT_PTR
	memDC      C.HDC
	memBmp     C.HBITMAP
	oldBmp     C.HBITMAP
	gfx        unsafe.Pointer
	ulwPtDst   C.POINT
	ulwSize    C.SIZE
	ulwBmpInfo C.BITMAPINFO
	fading     bool
	fadeFrame  int
	paintCount int
}

// ======================== 辅助函数 ========================

func detectDarkMode() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.READ)
	if err != nil {
		return true
	}
	defer k.Close()
	val, _, err := k.GetIntegerValue("AppsUseLightTheme")
	if err != nil {
		return true
	}
	return val == 0
}

func (s *splash) sp(v int) int { return int(float64(v) * s.dpiScale) }

func makeARGB(a, r, g, b byte) C.DWORD {
	return C.DWORD(uint32(a)<<24 | uint32(r)<<16 | uint32(g)<<8 | uint32(b))
}

// ======================== Go WndProc ========================

//export goSplashWndProc
func goSplashWndProc(hwnd C.HWND, msg C.UINT, wParam C.WPARAM, lParam C.LPARAM) C.LONG_PTR {
	sp := (*splash)(unsafe.Pointer(uintptr(C.GetWindowLongPtrW(hwnd, C.GWLP_USERDATA))))

	switch msg {
	case C.WM_CREATE:
		cs := (*C.CREATESTRUCTW)(unsafe.Pointer(uintptr(lParam)))
		C.SetWindowLongPtrW(hwnd, C.GWLP_USERDATA, C.LONG_PTR(uintptr(cs.lpCreateParams)))

	case C.WM_TIMER:
		if sp == nil {
			break
		}
		switch wParam {
		case timerTopmostID:
			// 周期性重设 TOPMOST，防止 Wails 创建主窗口时抢占 z-order
			if !sp.fading {
				C.SetWindowPos(hwnd, C.HWND_TOPMOST, 0, 0, 0, 0,
					C.SWP_NOMOVE|C.SWP_NOSIZE|C.SWP_NOACTIVATE)
			}
		default: // timerAnimID
			if sp.fading {
				sp.fadeFrame++
				alpha := 255 - (sp.fadeFrame * 255 / splashFadeOutFrames)
				if alpha <= 0 {
					C.KillTimer(hwnd, sp.timerID)
					C.DestroyWindow(hwnd)
					return 0
				}
				C.SetLayeredWindowAttributes(hwnd, 0, C.BYTE(alpha), C.LWA_ALPHA)
			}
			C.InvalidateRect(hwnd, nil, C.FALSE)
		}

	case C.WM_PAINT:
		if sp != nil {
			var ps C.PAINTSTRUCT
			hdc := C.BeginPaint(hwnd, &ps)
			sp.splashPaint(hdc)
			C.EndPaint(hwnd, &ps)
		}
		return 0

	case wmCloseSplash:
		if sp != nil {
			sp.fading = true
			sp.fadeFrame = 0
		}

	case C.WM_CLOSE:
		C.PostQuitMessage(0)

	case C.WM_DESTROY:
		if sp != nil {
			sp.splashCleanup()
		}
		if splashDone != nil {
			close(splashDone)
		}
	}

	return C.LONG_PTR(C.DefWindowProcW(hwnd, msg, wParam, lParam))
}

// ======================== 清理 ========================

func (s *splash) splashCleanup() {
	if s.gfx != nil {
		C.splashDeleteGraphics(s.gfx)
		s.gfx = nil
	}
	if s.memBmp != nil {
		C.SelectObject(s.memDC, C.HGDIOBJ(s.oldBmp))
		C.DeleteObject(C.HGDIOBJ(s.memBmp))
		s.memBmp = nil
	}
	if s.memDC != nil {
		C.DeleteDC(s.memDC)
		s.memDC = nil
	}
	C.splashFreeImages()
}

// ======================== 绘制 ========================

func (s *splash) splashPaint(dstDC C.HDC) {
	if s.memDC == nil {
		screenDC := C.GetDC(nil)
		s.memDC = C.CreateCompatibleDC(screenDC)

		s.ulwBmpInfo = C.BITMAPINFO{}
		s.ulwBmpInfo.bmiHeader.biSize = C.DWORD(unsafe.Sizeof(s.ulwBmpInfo.bmiHeader))
		s.ulwBmpInfo.bmiHeader.biWidth = C.LONG(s.w)
		s.ulwBmpInfo.bmiHeader.biHeight = -C.LONG(s.h)
		s.ulwBmpInfo.bmiHeader.biPlanes = 1
		s.ulwBmpInfo.bmiHeader.biBitCount = 32
		s.ulwBmpInfo.bmiHeader.biCompression = C.BI_RGB

		s.memBmp = C.CreateDIBSection(screenDC, &s.ulwBmpInfo, C.DIB_RGB_COLORS, nil, nil, 0)
		s.oldBmp = C.HBITMAP(C.SelectObject(s.memDC, C.HGDIOBJ(s.memBmp)))
		C.ReleaseDC(nil, screenDC)
		splashLogMsg(fmt.Sprintf("[Go] DIB: memDC=%p memBmp=%p size=%dx%d",
			s.memDC, s.memBmp, s.w, s.h))

		s.gfx = C.splashCreateGraphics(s.memDC)
		C.splashSetQuality(s.gfx)
		splashLogMsg(fmt.Sprintf("[Go] gfx=%p", s.gfx))
	}

	wf := C.float(s.w)
	hf := C.float(s.h)

	// ── 背景 ──
	var bgBrush unsafe.Pointer
	if s.dark {
		bgBrush = C.splashCreateSolidBrush(makeARGB(255, 24, 24, 27))
	} else {
		bgBrush = C.splashCreateSolidBrush(makeARGB(255, 250, 250, 250))
	}
	C.splashFillRect(s.gfx, bgBrush, 0, 0, wf, hf)
	C.splashDeleteBrush(bgBrush)

	// ── 描边（GDI RoundRect，与圆角窗口 region 匹配）──
	{
		var borderColor C.COLORREF
		if s.dark {
			borderColor = C.COLORREF(0x3E | (0x38 << 8) | (0x38 << 16)) // RGB(56,56,62)
		} else {
			borderColor = C.COLORREF(0xDC | (0xD8 << 8) | (0xD8 << 16)) // RGB(216,216,220)
		}
		hPen := C.CreatePen(C.PS_SOLID, C.int(1), borderColor)
		if hPen != nil {
			oldPen := C.SelectObject(s.memDC, C.HGDIOBJ(hPen))
			hNullBrush := C.GetStockObject(C.NULL_BRUSH)
			oldBrush := C.SelectObject(s.memDC, hNullBrush)
			C.RoundRect(s.memDC,
				C.int(0), C.int(0), C.int(s.w), C.int(s.h),
				C.int(s.sp(12)), C.int(s.sp(12)))
			C.SelectObject(s.memDC, oldPen)
			C.SelectObject(s.memDC, oldBrush)
			C.DeleteObject(C.HGDIOBJ(hPen))
		}
	}

	// ── 主 Logo（从缓存取，零 decode 开销）──
	var logoBottomY C.float
	{
		var gpImg unsafe.Pointer
		var iw, ih C.UINT
		darkFlag := C.int(0)
		if s.dark {
			darkFlag = 1
		}
		C.splashGetMainLogo(darkFlag, &gpImg, &iw, &ih)
		if s.paintCount == 0 {
			splashLogMsg(fmt.Sprintf("[Go] mainLogo: img=%p w=%d h=%d dark=%d", gpImg, int(iw), int(ih), int(darkFlag)))
		}
		if gpImg != nil {
			maxW := C.float(s.sp(340))
			maxH := C.float(s.sp(130))
			dw := C.float(iw)
			dh := C.float(ih)
			// 按比例缩小到 maxW×maxH 范围内
			if dw > maxW || dh > maxH {
				rw := dw / maxW
				rh := dh / maxH
				ratio := rw
				if rh > rw {
					ratio = rh
				}
				dw /= ratio
				dh /= ratio
			}
			dx := (wf - dw) / 2
			dy := hf*C.float(0.40) - dh/C.float(2)

			C.splashDrawImageRect(s.gfx, gpImg,
				C.int(int(dx)), C.int(int(dy)), C.int(int(dw)), C.int(int(dh)),
				0, 0, C.int(int(iw)), C.int(int(ih)))
			// 注意：不调用 splashDisposeImage，图像在缓存中复用

			logoBottomY = dy + dh
		}
	}

	// ── 公共边距 ──
	studioH := C.float(s.sp(20))
	studioMargin := C.float(s.sp(16))
	leftMargin := studioMargin

	// ── "正在启动..." ──
	textY := logoBottomY + C.float(s.sp(20))
	{
		textW, _ := syscall.UTF16FromString("正在启动...")
		font := C.splashCreateFont((*C.WCHAR)(unsafe.Pointer(mustUTF16Ptr("Segoe UI"))), C.float(s.sp(11)), 0)
		var brush unsafe.Pointer
		if s.dark {
			brush = C.splashCreateSolidBrush(makeARGB(255, 161, 161, 170))
		} else {
			brush = C.splashCreateSolidBrush(makeARGB(255, 113, 113, 122))
		}
		if font != nil {
			fmt := C.splashCreateStringFormat(0, 0) // 左对齐，顶部对齐
			C.splashDrawString(s.gfx,
				(*C.WCHAR)(unsafe.Pointer(&textW[0])), C.INT(len(textW)-1),
				font, leftMargin, textY, wf-leftMargin*2, C.float(s.sp(20)), fmt, brush)
			C.splashDeleteStringFormat(fmt)
			C.splashDeleteFont(font)
		}
		C.splashDeleteBrush(brush)
	}

	// ── 动态状态文字 ──
	splashMu.RLock()
	stText := splashStatusText
	splashMu.RUnlock()
	if stText != "" {
		stW, _ := syscall.UTF16FromString(stText)
		font := C.splashCreateFont((*C.WCHAR)(unsafe.Pointer(mustUTF16Ptr("Segoe UI"))), C.float(s.sp(9)), 0)
		var brush unsafe.Pointer
		if s.dark {
			brush = C.splashCreateSolidBrush(makeARGB(255, 82, 82, 91))
		} else {
			brush = C.splashCreateSolidBrush(makeARGB(255, 161, 161, 170))
		}
		if font != nil {
			fmt := C.splashCreateStringFormat(0, 0) // 左对齐，顶部对齐
			C.splashDrawString(s.gfx,
				(*C.WCHAR)(unsafe.Pointer(&stW[0])), C.INT(len(stW)-1),
				font, leftMargin, textY+C.float(s.sp(22)), wf-leftMargin*2, C.float(s.sp(16)), fmt, brush)
			C.splashDeleteStringFormat(fmt)
			C.splashDeleteFont(font)
		}
		C.splashDeleteBrush(brush)
	}

	// ── 启动进度条（窗口底部，Logo 上方，progress=0 时不绘制）──
	splashMu.RLock()
	progress := splashProgress
	splashMu.RUnlock()
	if progress > 0 {
		// 距底部 = studioMargin + studioH + sp(12)，让进度条在 Logo 上方留 12px 间距
		barY := hf - studioMargin - studioH - C.float(s.sp(12))
		barH := C.float(s.sp(4))
		barW := wf - leftMargin*2
		barX := leftMargin

		// 背景轨道
		var trackBrush unsafe.Pointer
		if s.dark {
			trackBrush = C.splashCreateSolidBrush(makeARGB(255, 42, 42, 50))
		} else {
			trackBrush = C.splashCreateSolidBrush(makeARGB(255, 228, 230, 235))
		}
		C.splashFillRect(s.gfx, trackBrush, barX, barY, barW, barH)
		C.splashDeleteBrush(trackBrush)

		// 前景填充（主色）
		fillW := barW * C.float(progress)
		var fillBrush unsafe.Pointer
		if s.dark {
			fillBrush = C.splashCreateSolidBrush(makeARGB(255, 123, 128, 248)) // #7B80F8
		} else {
			fillBrush = C.splashCreateSolidBrush(makeARGB(255, 86, 93, 240)) // #565DF0
		}
		C.splashFillRect(s.gfx, fillBrush, barX, barY, fillW, barH)
		C.splashDeleteBrush(fillBrush)
	}

	// ── 团队 Logo（左下角，缓存）──
	{
		var gpImg unsafe.Pointer
		var iw, ih C.UINT
		darkFlag := C.int(0)
		if s.dark {
			darkFlag = 1
		}
		C.splashGetStudioLogo(darkFlag, &gpImg, &iw, &ih)
		if gpImg != nil {
			dh := studioH
			dw := C.float(iw) * (dh / C.float(ih))
			C.splashDrawImageRect(s.gfx, gpImg,
				C.int(int(studioMargin)), C.int(int(hf-studioMargin-dh)), C.int(int(dw)), C.int(int(dh)),
				0, 0, C.int(int(iw)), C.int(int(ih)))
		}
	}

	// ── 版本号（右下角，与团队 Logo 底对齐）──
	// 使用 GDI DrawTextW 避免 GDI+ 在点号处换行
	{
		verStr := "v" + Version
		verW, _ := syscall.UTF16FromString(verStr)

		// 创建 GDI 字体
		hFont := C.CreateFontW(
			C.int(s.sp(9)), 0, 0, 0, C.FW_NORMAL, 0, 0, 0,
			C.DEFAULT_CHARSET, C.OUT_DEFAULT_PRECIS, C.CLIP_DEFAULT_PRECIS,
			C.CLEARTYPE_QUALITY, C.DEFAULT_PITCH|C.FF_DONTCARE,
			(*C.WCHAR)(unsafe.Pointer(mustUTF16Ptr("Segoe UI"))),
		)
		if hFont != nil {
			oldFont := C.SelectObject(s.memDC, C.HGDIOBJ(hFont))

			// 设置文字颜色
			var textColor C.COLORREF
			if s.dark {
				textColor = C.COLORREF(113 | (113 << 8) | (122 << 16))
			} else {
				textColor = C.COLORREF(161 | (161 << 8) | (170 << 16))
			}
			C.SetTextColor(s.memDC, textColor)
			C.SetBkMode(s.memDC, C.TRANSPARENT)

			// 绘制文字（右对齐，垂直居中，单行）
			rc := C.RECT{
				left:   0,
				top:    C.LONG(int(hf-studioMargin-studioH) + int(studioH)/2 - s.sp(9)/2),
				right:  C.LONG(int(wf) - int(studioMargin)),
				bottom: C.LONG(int(hf) - int(studioMargin)),
			}
			C.DrawTextW(s.memDC,
				(*C.WCHAR)(unsafe.Pointer(&verW[0])),
				C.int(len(verW)-1),
				&rc,
				C.DT_RIGHT|C.DT_VCENTER|C.DT_SINGLELINE,
			)

			C.SelectObject(s.memDC, oldFont)
			C.DeleteObject(C.HGDIOBJ(hFont))
		}
	}

	// ── BitBlt 到窗口 DC（不使用 UpdateLayeredWindow，改用 LWA_ALPHA 模式）──
	C.BitBlt(dstDC, 0, 0, C.int(s.w), C.int(s.h), s.memDC, 0, 0, C.SRCCOPY)
	s.paintCount++
	if s.paintCount <= 3 {
		splashLogMsg(fmt.Sprintf("[Go] BitBlt done paint#%d size=%dx%d",
			s.paintCount, s.w, s.h))
	}
}

func mustUTF16Ptr(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func splashLogMsg(msg string) {
	cs := C.CString(msg)
	C.splashLogStr(cs)
	C.free(unsafe.Pointer(cs))
}

// ======================== 窗口创建 + 消息循环 ========================

func splashRun(s *splash) {
	runtime.LockOSThread()

	// Pin 结构体（含 Go 指针/channel），CGo 要求传给 C 的 Go 指针必须 pinned
	var pinner runtime.Pinner
	pinner.Pin(s)
	defer pinner.Unpin()

	// DPI 感知
	user32 := syscall.NewLazyDLL("user32.dll")
	user32.NewProc("SetProcessDpiAwarenessContext").Call(^uintptr(3))

	// 初始化 GDI+
	gdipRet := C.splashGdipInit()
	splashLogMsg(fmt.Sprintf("[Go] splashGdipInit returned %d", int(gdipRet)))

	// 计算尺寸
	screenW := int(C.GetSystemMetrics(C.SM_CXSCREEN))
	s.w = screenW * 30 / 100
	s.h = s.w * 9 / 21
	s.dpiScale = float64(C.GetDpiForSystem()) / 96.0
	s.w = int(float64(s.w) * s.dpiScale)
	s.h = int(float64(s.h) * s.dpiScale)

	s.dark = detectDarkMode()
	splashLogMsg(fmt.Sprintf("[Go] size=%dx%d dpi=%.2f dark=%v screen=%dx%d",
		s.w, s.h, s.dpiScale, s.dark, screenW, int(C.GetSystemMetrics(C.SM_CYSCREEN))))

	// 用 C 分配窗口类名（避免 Go 指针嵌入 C 结构体）
	classNameStr := C.CString(splashClassName)
	defer C.free(unsafe.Pointer(classNameStr))
	classNameW := C.MultiByteToWideChar(C.CP_UTF8, 0, classNameStr, -1, nil, 0)
	classNameBuf := (*C.WCHAR)(C.malloc(C.size_t(classNameW) * C.size_t(unsafe.Sizeof(C.WCHAR(0)))))
	defer C.free(unsafe.Pointer(classNameBuf))
	C.MultiByteToWideChar(C.CP_UTF8, 0, classNameStr, -1, classNameBuf, classNameW)

	hInst := C.GetModuleHandleW(nil)
	wc := C.WNDCLASSEXW{
		cbSize:        C.UINT(unsafe.Sizeof(C.WNDCLASSEXW{})),
		style:         C.CS_HREDRAW | C.CS_VREDRAW,
		lpfnWndProc:   C.WNDPROC(C.splashWndProcC),
		hInstance:     hInst,
		lpszClassName: classNameBuf,
	}
	if s.dark {
		wc.hbrBackground = C.HBRUSH(unsafe.Pointer(C.CreateSolidBrush(C.COLORREF(0x1B1818))))
	} else {
		wc.hbrBackground = C.HBRUSH(unsafe.Pointer(C.CreateSolidBrush(C.COLORREF(0xFAFAFA))))
	}
	C.RegisterClassExW(&wc)

	x := (screenW - s.w) / 2
	screenH := int(C.GetSystemMetrics(C.SM_CYSCREEN))
	y := (screenH - s.h) / 2

	s.hwnd = C.CreateWindowExW(
		C.WS_EX_LAYERED|C.WS_EX_TOPMOST,
		classNameBuf, nil,
		C.WS_POPUP,
		C.INT(x), C.INT(y), C.INT(s.w), C.INT(s.h),
		nil, nil, hInst,
		C.LPVOID(unsafe.Pointer(s)),
	)
	if s.hwnd == nil {
		splashLogMsg(fmt.Sprintf("[Go] CreateWindowExW FAILED, GetLastError=%d", C.GetLastError()))
		if splashDone != nil {
			close(splashDone)
		}
		return
	}

	splashLogMsg(fmt.Sprintf("[Go] hwnd=%p pos=%d,%d size=%dx%d",
		s.hwnd, x, y, s.w, s.h))

	C.SetLayeredWindowAttributes(s.hwnd, 0, 255, C.LWA_ALPHA)

	// 圆角窗口：用 CreateRoundRectRgn 裁剪窗口形状（高速，无抗锯齿但视觉可接受）
	{
		cornerW := C.int(s.sp(12))
		cornerH := C.int(s.sp(12))
		rgn := C.CreateRoundRectRgn(0, 0, C.int(s.w+1), C.int(s.h+1), cornerW, cornerH)
		if rgn != nil {
			C.SetWindowRgn(s.hwnd, rgn, C.TRUE)
			// SetWindowRgn 接管 region 所有权，不需要 DeleteObject
		}
	}

	// 预绘制框架：图片未缓存时 splashPaint 自动跳过 Logo，progress=0 时跳过进度条
	// 此时不画 Logo 和进度条，只画背景+描边+"正在启动..."文字
	hdc := C.GetDC(s.hwnd)
	s.splashPaint(hdc)
	C.ReleaseDC(s.hwnd, hdc)
	splashLogMsg("[Go] pre-show splashPaint done (frame only)")

	// 显示窗口（框架立即可见：背景+描边+文字，无 Logo 无进度条）
	C.ShowWindow(s.hwnd, C.SW_SHOW)
	splashVisible.Store(true)
	splashLogMsg("[Go] ShowWindow done (early show)")

	// 预加载并缓存所有 Logo（窗口已显示后才 decode，不阻塞弹出）
	C.splashCacheImages(
		unsafe.Pointer(&bootLogoLightPNG[0]), C.UINT(len(bootLogoLightPNG)),
		unsafe.Pointer(&bootLogoDarkPNG[0]), C.UINT(len(bootLogoDarkPNG)),
		unsafe.Pointer(&studioLogoLightPNG[0]), C.UINT(len(studioLogoLightPNG)),
		unsafe.Pointer(&studioLogoDarkPNG[0]), C.UINT(len(studioLogoDarkPNG)),
	)
	splashLogMsg("[Go] splashCacheImages done")

	// 完整绘制（含 Logo），触发重绘
	hdc = C.GetDC(s.hwnd)
	s.splashPaint(hdc)
	C.ReleaseDC(s.hwnd, hdc)
	splashLogMsg("[Go] full splashPaint done")
	C.InvalidateRect(s.hwnd, nil, C.FALSE) // 触发 WM_PAINT
	C.UpdateWindow(s.hwnd)
	splashLogMsg("[Go] UpdateWindow done, entering message loop")

	s.timerID = C.SetTimer(s.hwnd, timerAnimID, 30, nil)
	C.SetTimer(s.hwnd, timerTopmostID, 300, nil) // 每 300ms 重设 TOPMOST

	var msg C.MSG
	for C.GetMessageW(&msg, nil, 0, 0) > 0 {
		C.TranslateMessage(&msg)
		C.DispatchMessageW(&msg)
	}

	C.KillTimer(s.hwnd, s.timerID)
	C.KillTimer(s.hwnd, timerTopmostID)
	C.UnregisterClassW(classNameBuf, hInst)
	C.DeleteObject(C.HGDIOBJ(wc.hbrBackground))
}

// ======================== 公开 API ========================

func showSplash() {
	splashCreatedAt = time.Now()
	sp := &splash{}
	splashDone = make(chan struct{})
	go func() { splashRun(sp) }()
	// 等待窗口真正显示（ShowWindow 后才设 splashVisible），而非仅 hwnd 创建
	for !splashVisible.Load() {
		time.Sleep(time.Millisecond)
	}
}

func updateSplashStatus(text string) {
	splashMu.Lock()
	splashStatusText = text
	splashMu.Unlock()
}

// updateSplashProgress 更新启动进度条（0.0 ~ 1.0）
func updateSplashProgress(p float32) {
	if p < 0 {
		p = 0
	}
	if p > 1 {
		p = 1
	}
	splashMu.Lock()
	splashProgress = p
	splashMu.Unlock()
}

func closeSplash() {
	if splashDone == nil {
		return
	}

	// 按实际启动耗时关闭，不强制最小展示时间
	cNameStr := C.CString(splashClassName)
	defer C.free(unsafe.Pointer(cNameStr))
	cNameLen := C.MultiByteToWideChar(C.CP_UTF8, 0, cNameStr, -1, nil, 0)
	cNameBuf := (*C.WCHAR)(C.malloc(C.size_t(cNameLen) * C.size_t(unsafe.Sizeof(C.WCHAR(0)))))
	defer C.free(unsafe.Pointer(cNameBuf))
	C.MultiByteToWideChar(C.CP_UTF8, 0, cNameStr, -1, cNameBuf, cNameLen)

	hwnd := C.FindWindowW(cNameBuf, nil)
	if hwnd != nil {
		C.PostMessageW(hwnd, wmCloseSplash, 0, 0)
	}
	<-splashDone
	splashDone = nil
	splashVisible.Store(false)
}
