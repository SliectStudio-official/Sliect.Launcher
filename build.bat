@echo off
REM ── Sliect Launcher 构建脚本 ──
REM 自动生成版本号 major.minor.mmyydd.hhmm 并通过 ldflags 注入

REM 设置 MinGW-w64 路径
for /f "delims=" %%d in ('dir /b /ad "%LOCALAPPDATA%\Microsoft\WinGet\Packages\BrechtSanders.WinLibs*" 2^>nul') do (
    set "MINGW=%LOCALAPPDATA%\Microsoft\WinGet\Packages\%%d\mingw64\bin"
)
if exist "%MINGW%\gcc.exe" (
    set "PATH=%MINGW%;%PATH%"
)

REM 杀残留进程
taskkill /F /IM SliectLauncher.exe >nul 2>&1

REM 生成版本号: major.minor.mmyydd.hhmm
set "MAJOR=0"
set "MINOR=1"
for /f "tokens=1-3 delims=/" %%a in ("%date%") do set "D=%%a%%b%%c"
for /f "tokens=1-2 delims=:" %%a in ("%time: =0%") do set "T=%%a%%b"
set "VERSION=%MAJOR%.%MINOR%.%D:~2%.%T%"

echo Building SliectLauncher v%VERSION% ...
wails build -ldflags "-X main.Version=%VERSION%"
