//go:build windows

package main

/*
#include <windows.h>
#include <shellapi.h>
#include <commctrl.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

// ── Callback from C to Go ──
extern LONG_PTR goTrayWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

static LRESULT CALLBACK trayWndProcC(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    return (LRESULT)goTrayWndProc(hwnd, msg, wParam, lParam);
}

// ── Helper: extract low word from DWORD ──
static WORD cLOWORD(DWORD v) { return (WORD)(v & 0xFFFF); }

// ── Helper: create message-only window ──
static HWND createMessageWnd(LPCWSTR className, HINSTANCE hInst, WNDPROC proc) {
    WNDCLASSEXW wc = {0};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = proc;
    wc.hInstance = hInst;
    wc.lpszClassName = className;
    if (!RegisterClassExW(&wc)) return NULL;
    return CreateWindowExW(0, className, className, 0,
        0, 0, 0, 0, HWND_MESSAGE, NULL, hInst, NULL);
}

// ── Helper: load default application icon ──
static HICON loadDefaultIcon(void) {
    return LoadIconW(NULL, MAKEINTRESOURCEW(32512));
}

// ── Helper: fill NOTIFYICONDATAW and call Shell_NotifyIconW ──
static BOOL trayNotify(HWND hwnd, HICON icon, DWORD action, const WCHAR* tooltip) {
    NOTIFYICONDATAW nid = {0};
    nid.cbSize = sizeof(nid);
    nid.hWnd = hwnd;
    nid.uID = 1;
    nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    nid.uCallbackMessage = WM_APP + 1;
    nid.hIcon = icon;
    if (tooltip) {
        wcsncpy(nid.szTip, tooltip, 127);
    }
    return Shell_NotifyIconW(action, &nid);
}

// ── Helper: remove tray icon ──
static BOOL trayRemove(HWND hwnd) {
    NOTIFYICONDATAW nid = {0};
    nid.cbSize = sizeof(nid);
    nid.hWnd = hwnd;
    nid.uID = 1;
    return Shell_NotifyIconW(NIM_DELETE, &nid);
}

// ── Helper: message loop ──
static void runMessageLoop(void) {
    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

// ── Helper: show tray popup menu ──
static UINT showTrayMenuC(HWND hwnd, const WCHAR* showText, const WCHAR* quitText) {
    HMENU menu = CreatePopupMenu();
    if (!menu) return 0;
    AppendMenuW(menu, MF_STRING, 1, showText);
    AppendMenuW(menu, MF_SEPARATOR, 0, NULL);
    AppendMenuW(menu, MF_STRING, 2, quitText);
    SetMenuDefaultItem(menu, 1, FALSE);

    POINT pt;
    GetCursorPos(&pt);
    SetForegroundWindow(hwnd);

    UINT cmd = TrackPopupMenu(menu,
        TPM_RIGHTALIGN | TPM_BOTTOMALIGN | TPM_NONOTIFY | TPM_RETURNCMD,
        pt.x, pt.y, 0, hwnd, NULL);
    PostMessageW(hwnd, WM_NULL, 0, 0);
    DestroyMenu(menu);
    return cmd;
}

// ── Helper: post WM_QUIT to tray thread ──
static void quitTrayThread(HWND hwnd) {
    DWORD tid = GetWindowThreadProcessId(hwnd, NULL);
    PostThreadMessageW(tid, WM_QUIT, 0, 0);
}

// ── Helper: expose WNDPROC pointer ──
static WNDPROC getTrayWndProc(void) { return trayWndProcC; }

// ── Load HICON from ICO data in memory (Windows native) ──
static HICON loadIconFromData(const void* data, int size, int cx, int cy) {
    int id = LookupIconIdFromDirectoryEx((BYTE*)data, TRUE, cx, cy, LR_DEFAULTCOLOR);
    if (id <= 0) return NULL;
    return CreateIconFromResourceEx(
        (BYTE*)data + id, size - id,
        TRUE, 0x30000, cx, cy, LR_DEFAULTCOLOR);
}
*/
// #cgo LDFLAGS: -lole32 -lgdi32 -luser32 -lshell32 -lcomctl32
import "C"

import (
	_ "embed"
	"log"
	"runtime"
	"unsafe"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed build/appicon.ico
var trayIconICO []byte

// Global state for the tray (single instance)
var (
	trayWnd      C.HWND
	trayHIcon    C.HICON
	trayInstance *App
)

//export goTrayWndProc
func goTrayWndProc(hwnd C.HWND, msg C.UINT, wParam C.WPARAM, lParam C.LPARAM) C.LONG_PTR {
	switch msg {
	case C.WM_APP + 1:
		action := C.cLOWORD(C.DWORD(lParam))
		switch action {
		case C.WM_LBUTTONDBLCLK:
			if trayInstance != nil {
				trayInstance.showMainWindow()
			}
		case C.WM_RBUTTONUP:
			showText := utf16CStr("显示窗口")
			quitText := utf16CStr("退出")
			cmd := C.showTrayMenuC(hwnd, showText, quitText)
			switch cmd {
			case 1:
				if trayInstance != nil {
					trayInstance.showMainWindow()
				}
			case 2:
				if trayInstance != nil {
					wailsRuntime.Quit(trayInstance.ctx)
				}
			}
		}
		return 0
	case C.WM_DESTROY:
		return 0
	}
	return C.LONG_PTR(C.DefWindowProcW(hwnd, msg, wParam, lParam))
}

// initTray creates a native Windows system tray icon.
func (a *App) initTray() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	trayInstance = a

	C.CoInitializeEx(nil, C.COINIT_APARTMENTTHREADED)
	defer C.CoUninitialize()

	className := utf16CStr("SliectLauncherTrayWnd")
	hInst := C.GetModuleHandleW(nil)

	trayWnd = C.createMessageWnd(className, hInst, C.getTrayWndProc())
	if trayWnd == nil {
		log.Printf("[Tray] createMessageWnd failed: %d", C.GetLastError())
		return
	}

	// Load icon from embedded ICO data (native Windows, no GDI+ needed)
	trayHIcon = loadTrayIcon()
	if trayHIcon == nil {
		log.Println("[Tray] all icon loading methods failed, using default")
		trayHIcon = C.loadDefaultIcon()
	}

	tooltip := utf16CStr("Sliect Launcher - 启动台")
	if C.trayNotify(trayWnd, trayHIcon, C.NIM_ADD, tooltip) == 0 {
		log.Println("[Tray] Shell_NotifyIconW NIM_ADD failed")
		C.DestroyWindow(trayWnd)
		return
	}
	log.Println("[Tray] system tray icon added successfully")

	C.runMessageLoop()

	C.trayRemove(trayWnd)
	if trayHIcon != nil {
		C.DestroyIcon(trayHIcon)
	}
	C.DestroyWindow(trayWnd)
	log.Println("[Tray] system tray cleaned up")
}

// removeTrayIcon removes the tray icon and stops the message loop.
func removeTrayIcon() {
	if trayWnd != nil {
		C.trayRemove(trayWnd)
		C.quitTrayThread(trayWnd)
	}
}

// loadTrayIcon loads HICON from embedded ICO data using native Windows API.
func loadTrayIcon() C.HICON {
	if len(trayIconICO) == 0 {
		log.Println("[Tray] no ICO data embedded")
		return nil
	}

	// Try 32x32 first (standard tray size)
	icon := C.loadIconFromData(
		unsafe.Pointer(&trayIconICO[0]),
		C.int(len(trayIconICO)),
		32, 32,
	)
	if icon != nil {
		log.Println("[Tray] loaded 32x32 icon from ICO")
		return icon
	}

	// Try 16x16 as fallback
	icon = C.loadIconFromData(
		unsafe.Pointer(&trayIconICO[0]),
		C.int(len(trayIconICO)),
		16, 16,
	)
	if icon != nil {
		log.Println("[Tray] loaded 16x16 icon from ICO")
		return icon
	}

	// Try with LR_DEFAULTSIZE (system chooses best size)
	icon = C.loadIconFromData(
		unsafe.Pointer(&trayIconICO[0]),
		C.int(len(trayIconICO)),
		0, 0,
	)
	if icon != nil {
		log.Println("[Tray] loaded default-size icon from ICO")
		return icon
	}

	log.Println("[Tray] ICO loading failed, trying CreateIconFromResourceEx directly")
	// Last resort: try CreateIconFromResourceEx on the whole ICO data
	icon = C.CreateIconFromResourceEx(
		(*C.BYTE)(unsafe.Pointer(&trayIconICO[0])),
		C.DWORD(len(trayIconICO)),
		1,       // TRUE = icon
		0x30000, // version
		32, 32,
		C.LR_DEFAULTCOLOR,
	)
	if icon != nil {
		log.Println("[Tray] loaded icon via CreateIconFromResourceEx")
	}
	return icon
}

// showMainWindow shows and focuses the main Wails window.
func (a *App) showMainWindow() {
	if a.ctx == nil {
		return
	}
	wailsRuntime.WindowShow(a.ctx)
	wailsRuntime.WindowUnminimise(a.ctx)
	wailsRuntime.WindowSetAlwaysOnTop(a.ctx, true)
	wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false)
}

// utf16CStr encodes a Go string as a null-terminated UTF-16 C string.
func utf16CStr(s string) *C.WCHAR {
	encoded := append(encodeUTF16(s), 0)
	return (*C.WCHAR)(unsafe.Pointer(&encoded[0]))
}

// encodeUTF16 converts a Go string to UTF-16 code units.
func encodeUTF16(s string) []uint16 {
	var result []uint16
	for _, r := range s {
		if r < 0x10000 {
			result = append(result, uint16(r))
		} else {
			r -= 0x10000
			result = append(result, 0xD800+uint16(r>>10), 0xDC00+uint16(r&0x3FF))
		}
	}
	return result
}
