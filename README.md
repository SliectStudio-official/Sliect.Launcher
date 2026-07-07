# Sliect Launcher

Sliect Studio 开发的多用途服务端启动器，基于 `https://wails.io/` 构建的跨平台桌面应用。

## 功能特性

- **进程管理** — 启动、监控、管理游戏服务端进程
- **系统监控** — 实时监控系统资源使用情况
- **日志缓冲** — 高效的服务端日志输出与展示
- **系统托盘** — 后台运行，托盘快捷操作
- **多平台支持** — Windows / macOS

## 技术栈

| 层级    | 技术                                |
| ----- | --------------------------------- |
| 后端    | Go                                |
| 前端    | HTML + CSS + JavaScript (Vanilla) |
| 桌面框架  | Wails v2                          |
| 构建安装包 | NSIS (Windows)                    |

## 快速开始

### 前置要求

- [Go](https://go.dev/) 1.21+
- [Node.js](https://nodejs.org/) 18+
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

### 开发模式

```bash
wails dev
```

前端热重载，同时可在浏览器访问 `http://localhost:34115` 调试 Go 接口。

### 构建

```bash
wails build
```

编译后的可执行文件位于 `build/bin/` 目录。

## 项目结构

```
├── main.go                  # 入口
├── app.go                   # 应用核心逻辑
├── wails.json               # Wails 项目配置
├── internal/
│   ├── config/              # 配置管理
│   ├── model/               # 数据模型
│   ├── process/             # 进程管理
│   └── sysmonitor/          # 系统监控
├── frontend/
│   ├── src/                 # 前端源码
│   ├── public/              # 静态资源
│   └── index.html           # 入口 HTML
├── build/
│   ├── windows/installer/   # NSIS 安装脚本
│   └── darwin/              # macOS 配置
└── files/                   # 品牌素材
```

## 许可证

[GNU General Public License v3.0](LICENSE)

Copyright (c) 2026 Sliect Studio

