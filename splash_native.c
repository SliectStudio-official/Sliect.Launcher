#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>

/* ── 诊断日志 ── */
void splashLog(const char *fmt, ...) {
    char path[MAX_PATH];
    DWORD len = GetTempPathA(MAX_PATH, path);
    if (len == 0) return;
    lstrcatA(path, "splash_debug.log");
    FILE *f = fopen(path, "a");
    if (!f) return;
    va_list args;
    va_start(args, fmt);
    vfprintf(f, fmt, args);
    va_end(args);
    fprintf(f, "\n");
    fflush(f);
    fclose(f);
}

void splashLogStr(const char *msg) {
    splashLog("%s", msg);
}

/* ================================================================
 *  GDI+ 动态加载 — MinGW-w64 libgdiplus.a 可能不导出 flat API，
 *  所以运行时通过 GetProcAddress 从 gdiplus.dll 加载。
 * ================================================================ */

static HMODULE g_gpDll;

typedef int             GPSTATUS;
typedef ULONG_PTR       GPTOKEN;
typedef void*           GpGraphics;
typedef void*           GpImage;
typedef void*           GpBrush;
typedef void*           GpFont;
typedef void*           GpFontFamily;
typedef void*           GpStringFormat;

typedef struct {
    UINT32 GdiplusVersion;
    void (*DebugEventCallback)(void*, UINT32, void*);
    BOOL SuppressBackgroundThread;
    BOOL SuppressExternalCodecs;
} GPINPUT;

typedef struct {
    float X, Y, Width, Height;
} GPRECTF;

/* 函数指针 — 注意：GdiplusStartup/GdiplusShutdown 用 Gdiplus 前缀，
 * 其余 flat API 用 Gdip 前缀（已验证 gdiplus.dll 导出表） */
static GPSTATUS (WINAPI *pGdiplusStartup)(GPTOKEN*, const GPINPUT*, void*);
static GPSTATUS (WINAPI *pGdiplusShutdown)(GPTOKEN);
static GPSTATUS (WINAPI *pGdipCreateFromHDC)(HDC, GpGraphics**);
static GPSTATUS (WINAPI *pGdipDeleteGraphics)(GpGraphics*);
static GPSTATUS (WINAPI *pGdipSetSmoothingMode)(GpGraphics*, int);
static GPSTATUS (WINAPI *pGdipSetTextRenderingHint)(GpGraphics*, int);
static GPSTATUS (WINAPI *pGdipCreateFontFamilyFromName)(const WCHAR*, void*, GpFontFamily**);
static GPSTATUS (WINAPI *pGdipDeleteFontFamily)(GpFontFamily*);
static GPSTATUS (WINAPI *pGdipCreateFont)(GpFontFamily*, float, int, int, GpFont**);
static GPSTATUS (WINAPI *pGdipDeleteFont)(GpFont*);
static GPSTATUS (WINAPI *pGdipCreateSolidFill)(DWORD, GpBrush**);
static GPSTATUS (WINAPI *pGdipDeleteBrush)(GpBrush*);
static GPSTATUS (WINAPI *pGdipDrawImageRectRectI)(GpGraphics*, GpImage*, INT, INT, INT, INT, INT, INT, INT, INT, int, void*, void*, void*);
static GPSTATUS (WINAPI *pGdipFillRectangle)(GpGraphics*, GpBrush*, float, float, float, float);
static GPSTATUS (WINAPI *pGdipDrawString)(GpGraphics*, const WCHAR*, int, GpFont*, const GPRECTF*, GpStringFormat*, GpBrush*);
static GPSTATUS (WINAPI *pGdipLoadImageFromStream)(void*, GpImage**);
static GPSTATUS (WINAPI *pGdipDisposeImage)(GpImage*);
static GPSTATUS (WINAPI *pGdipGetImageWidth)(GpImage*, UINT*);
static GPSTATUS (WINAPI *pGdipGetImageHeight)(GpImage*, UINT*);
static GPSTATUS (WINAPI *pGdipCreateStringFormat)(int, int, GpStringFormat**);
static GPSTATUS (WINAPI *pGdipSetStringFormatAlign)(GpStringFormat*, int);
static GPSTATUS (WINAPI *pGdipSetStringFormatLineAlign)(GpStringFormat*, int);
static GPSTATUS (WINAPI *pGdipDeleteStringFormat)(GpStringFormat*);

#define LOAD_SYM(name) p##name = (void*)GetProcAddress(g_gpDll, #name)

/* ── IStream 辅助：从内存缓冲区创建 IStream（gdiplus.dll 不导出 GdipLoadImageFromMemory） ── */

typedef HRESULT (WINAPI *PFN_CreateStreamOnHGlobal)(HGLOBAL, BOOL, void**);
static PFN_CreateStreamOnHGlobal pCreateStreamOnHGlobal;

/* 从内存加载图像：CreateStreamOnHGlobal → GdipLoadImageFromStream */
static int splashImageFromMemory(const void *data, UINT size, GpImage **img) {
    if (!pGdipLoadImageFromStream) return -1;

    /* 延迟加载 CreateStreamOnHGlobal（ole32.dll） */
    if (!pCreateStreamOnHGlobal) {
        HMODULE hOle = LoadLibraryA("ole32.dll");
        if (hOle) pCreateStreamOnHGlobal = (PFN_CreateStreamOnHGlobal)GetProcAddress(hOle, "CreateStreamOnHGlobal");
        if (!pCreateStreamOnHGlobal) {
            splashLog("[FAIL] CreateStreamOnHGlobal not found in ole32.dll");
            return -2;
        }
    }

    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, size);
    if (!hMem) { splashLog("[FAIL] GlobalAlloc(%u) failed err=%lu", size, GetLastError()); return -3; }

    void *buf = GlobalLock(hMem);
    memcpy(buf, data, size);
    GlobalUnlock(hMem);

    void *stream = NULL;
    HRESULT hr = pCreateStreamOnHGlobal(hMem, TRUE /*fDeleteOnRelease*/, &stream);
    if (FAILED(hr) || !stream) {
        splashLog("[FAIL] CreateStreamOnHGlobal hr=0x%08lx", (long)hr);
        GlobalFree(hMem);
        return -4;
    }

    int st = pGdipLoadImageFromStream(stream, img);
    splashLog("[INFO] GdipLoadImageFromStream: st=%d img=%p", st, *img);

    /* IStream::Release — 通过 vtable 手动调用（避免 COM 头依赖） */
    typedef unsigned long (__stdcall *PFN_Release)(void*);
    void **vtable = *(void***)stream;
    PFN_Release pRelease = (PFN_Release)vtable[2];
    pRelease(stream);  /* fDeleteOnRelease=TRUE，同时释放 HGLOBAL */

    return st;
}

/* splashGdipInit: 加载 gdiplus.dll + 初始化。返回 0=成功 */
int splashGdipInit(void) {
    g_gpDll = LoadLibraryA("gdiplus.dll");
    if (!g_gpDll) { splashLog("[FAIL] LoadLibrary gdiplus.dll err=%lu", GetLastError()); return -1; }
    splashLog("[OK] gdiplus.dll loaded");

    LOAD_SYM(GdiplusStartup);
    LOAD_SYM(GdiplusShutdown);
    LOAD_SYM(GdipCreateFromHDC);
    LOAD_SYM(GdipDeleteGraphics);
    LOAD_SYM(GdipSetSmoothingMode);
    LOAD_SYM(GdipSetTextRenderingHint);
    LOAD_SYM(GdipCreateFontFamilyFromName);
    LOAD_SYM(GdipDeleteFontFamily);
    LOAD_SYM(GdipCreateFont);
    LOAD_SYM(GdipDeleteFont);
    LOAD_SYM(GdipCreateSolidFill);
    LOAD_SYM(GdipDeleteBrush);
    LOAD_SYM(GdipDrawImageRectRectI);
    LOAD_SYM(GdipFillRectangle);
    LOAD_SYM(GdipDrawString);
    LOAD_SYM(GdipLoadImageFromStream);
    LOAD_SYM(GdipDisposeImage);
    LOAD_SYM(GdipGetImageWidth);
    LOAD_SYM(GdipGetImageHeight);
    LOAD_SYM(GdipCreateStringFormat);
    LOAD_SYM(GdipSetStringFormatAlign);
    LOAD_SYM(GdipSetStringFormatLineAlign);
    LOAD_SYM(GdipDeleteStringFormat);

    splashLog("[INFO] pGdiplusStartup=%p pGdipLoadImageFromStream=%p pGdipCreateFromHDC=%p pGdipFillRectangle=%p",
        pGdiplusStartup, pGdipLoadImageFromStream, pGdipCreateFromHDC, pGdipFillRectangle);

    if (!pGdiplusStartup) { splashLog("[FAIL] GdiplusStartup not found"); return -2; }
    GPINPUT input = {0};
    input.GdiplusVersion = 1;
    GPTOKEN token = 0;
    int st = pGdiplusStartup(&token, &input, NULL);
    splashLog("[INFO] GdiplusStartup returned %d token=%lu", st, (unsigned long)token);
    return st;
}

/* ── GDI+ 包装函数 ── */

void* splashCreateGraphics(HDC hdc) {
    GpGraphics *g = NULL;
    if (pGdipCreateFromHDC) pGdipCreateFromHDC(hdc, &g);
    splashLog("[INFO] splashCreateGraphics hdc=%p -> gfx=%p", hdc, g);
    return g;
}

void splashDeleteGraphics(void *g) {
    if (pGdipDeleteGraphics && g) pGdipDeleteGraphics(g);
}

void splashSetQuality(void *g) {
    if (pGdipSetSmoothingMode) pGdipSetSmoothingMode(g, 4);
    if (pGdipSetTextRenderingHint) pGdipSetTextRenderingHint(g, 5);
}

void* splashCreateSolidBrush(DWORD argb) {
    GpBrush *b = NULL;
    if (pGdipCreateSolidFill) pGdipCreateSolidFill(argb, &b);
    return b;
}

void splashDeleteBrush(void *b) {
    if (pGdipDeleteBrush && b) pGdipDeleteBrush(b);
}

void splashFillRect(void *g, void *brush, float x, float y, float w, float h) {
    if (pGdipFillRectangle) pGdipFillRectangle(g, brush, x, y, w, h);
}

/* ── 图像缓存（启动时一次性加载，每帧直接复用） ── */

static GpImage *g_imgMainLight;
static GpImage *g_imgMainDark;
static GpImage *g_imgStudioLight;
static GpImage *g_imgStudioDark;
static UINT g_mainLightW, g_mainLightH;
static UINT g_mainDarkW, g_mainDarkH;
static UINT g_studioLightW, g_studioLightH;
static UINT g_studioDarkW, g_studioDarkH;

void splashCacheImages(const void *mlD, UINT mlS,
                       const void *mdD, UINT mdS,
                       const void *slD, UINT slS,
                       const void *sdD, UINT sdS) {
    if (!pGdipLoadImageFromStream) { splashLog("[FAIL] pGdipLoadImageFromStream is NULL"); return; }

    splashImageFromMemory(mlD, mlS, &g_imgMainLight);
    splashLog("[INFO] MainLight: %p (%u bytes)", g_imgMainLight, mlS);
    splashImageFromMemory(mdD, mdS, &g_imgMainDark);
    splashLog("[INFO] MainDark: %p (%u bytes)", g_imgMainDark, mdS);
    splashImageFromMemory(slD, slS, &g_imgStudioLight);
    splashLog("[INFO] StudioLight: %p (%u bytes)", g_imgStudioLight, slS);
    splashImageFromMemory(sdD, sdS, &g_imgStudioDark);
    splashLog("[INFO] StudioDark: %p (%u bytes)", g_imgStudioDark, sdS);

    if (g_imgMainLight && pGdipGetImageWidth) {
        pGdipGetImageWidth(g_imgMainLight, &g_mainLightW);
        pGdipGetImageHeight(g_imgMainLight, &g_mainLightH);
        splashLog("[INFO] MainLight size: %ux%u", g_mainLightW, g_mainLightH);
    }
    if (g_imgMainDark && pGdipGetImageWidth) {
        pGdipGetImageWidth(g_imgMainDark, &g_mainDarkW);
        pGdipGetImageHeight(g_imgMainDark, &g_mainDarkH);
        splashLog("[INFO] MainDark size: %ux%u", g_mainDarkW, g_mainDarkH);
    }
    if (g_imgStudioLight && pGdipGetImageWidth) {
        pGdipGetImageWidth(g_imgStudioLight, &g_studioLightW);
        pGdipGetImageHeight(g_imgStudioLight, &g_studioLightH);
        splashLog("[INFO] StudioLight size: %ux%u", g_studioLightW, g_studioLightH);
    }
    if (g_imgStudioDark && pGdipGetImageWidth) {
        pGdipGetImageWidth(g_imgStudioDark, &g_studioDarkW);
        pGdipGetImageHeight(g_imgStudioDark, &g_studioDarkH);
        splashLog("[INFO] StudioDark size: %ux%u", g_studioDarkW, g_studioDarkH);
    }
}

void splashGetMainLogo(int dark, void **img, UINT *w, UINT *h) {
    if (dark && g_imgMainLight) { *img = g_imgMainLight; *w = g_mainLightW; *h = g_mainLightH; }
    else if (!dark && g_imgMainDark)   { *img = g_imgMainDark; *w = g_mainDarkW; *h = g_mainDarkH; }
    else { *img = NULL; *w = 0; *h = 0; }
}

void splashGetStudioLogo(int dark, void **img, UINT *w, UINT *h) {
    if (dark && g_imgStudioLight) { *img = g_imgStudioLight; *w = g_studioLightW; *h = g_studioLightH; }
    else if (!dark && g_imgStudioDark)   { *img = g_imgStudioDark; *w = g_studioDarkW; *h = g_studioDarkH; }
    else { *img = NULL; *w = 0; *h = 0; }
}

void splashFreeImages(void) {
    if (pGdipDisposeImage) {
        if (g_imgMainLight)   pGdipDisposeImage(g_imgMainLight);
        if (g_imgMainDark)    pGdipDisposeImage(g_imgMainDark);
        if (g_imgStudioLight) pGdipDisposeImage(g_imgStudioLight);
        if (g_imgStudioDark)  pGdipDisposeImage(g_imgStudioDark);
    }
    g_imgMainLight = g_imgMainDark = g_imgStudioLight = g_imgStudioDark = NULL;
}

void* splashLoadImage(const void *data, UINT size) {
    GpImage *img = NULL;
    splashImageFromMemory(data, size, &img);
    return img;
}

void splashDisposeImage(void *img) {
    if (pGdipDisposeImage && img) pGdipDisposeImage(img);
}

void splashGetImageSize(void *img, UINT *w, UINT *h) {
    if (pGdipGetImageWidth) pGdipGetImageWidth(img, w);
    if (pGdipGetImageHeight) pGdipGetImageHeight(img, h);
}

void splashDrawImageRect(void *g, void *img, int dx, int dy, int dw, int dh,
                         int sx, int sy, int sw, int sh) {
    if (pGdipDrawImageRectRectI)
        pGdipDrawImageRectRectI(g, img, dx, dy, dw, dh, sx, sy, sw, sh,
                                2, NULL, NULL, NULL);
}

void* splashCreateFont(const WCHAR *familyName, float emSize, int bold) {
    GpFontFamily *family = NULL;
    GpFont *font = NULL;
    if (!pGdipCreateFontFamilyFromName || !pGdipCreateFont) return NULL;

    if (pGdipCreateFontFamilyFromName(familyName, NULL, &family) != 0 || !family) {
        /* fallback to Arial */
        static const WCHAR arial[] = L"Arial";
        if (pGdipCreateFontFamilyFromName(arial, NULL, &family) != 0 || !family)
            return NULL;
    }
    pGdipCreateFont(family, emSize, bold ? 1 : 0, 2 /*UnitPixel*/, &font);
    pGdipDeleteFontFamily(family);
    return font;
}

void splashDeleteFont(void *font) {
    if (pGdipDeleteFont && font) pGdipDeleteFont(font);
}

void* splashCreateStringFormat(int hAlign, int vAlign) {
    GpStringFormat *fmt = NULL;
    if (!pGdipCreateStringFormat) return NULL;
    pGdipCreateStringFormat(hAlign, 0, &fmt);
    if (fmt) {
        if (pGdipSetStringFormatAlign) pGdipSetStringFormatAlign(fmt, hAlign);
        if (pGdipSetStringFormatLineAlign) pGdipSetStringFormatLineAlign(fmt, vAlign);
    }
    return fmt;
}

void splashDeleteStringFormat(void *fmt) {
    if (pGdipDeleteStringFormat && fmt) pGdipDeleteStringFormat(fmt);
}

void splashDrawString(void *g, const WCHAR *text, int len, void *font,
                      float rx, float ry, float rw, float rh,
                      void *fmt, void *brush) {
    if (!pGdipDrawString) return;
    GPRECTF rc = {rx, ry, rw, rh};
    pGdipDrawString(g, text, len, font, &rc, fmt, brush);
}

void splashShutdown(void) {
    /* token 在 Go 侧管理，这里不关闭 */
}

/* ================================================================
 *  WNDPROC trampoline — 转发到 Go //export goSplashWndProc
 * ================================================================ */

extern LONG_PTR goSplashWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

LRESULT CALLBACK splashWndProcC(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    return (LRESULT)goSplashWndProc(hwnd, msg, wParam, lParam);
}
