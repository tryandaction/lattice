# Lattice 桌面应用

## 概述

Lattice 桌面应用基于 [Tauri 2.x](https://tauri.app/) 构建，提供原生桌面体验。

**特点：**
- 体积小巧（~6-7 MB）
- 完全离线运行
- 原生文件系统访问
- 跨平台支持

## 下载安装

### Windows

从 [Releases](https://github.com/tryandaction/lattice/releases/latest) 下载：

| 文件 | 说明 | 大小 |
|------|------|------|
| `Lattice_x.x.x_x64-setup.exe` | NSIS 安装程序（推荐） | ~6 MB |
| `Lattice_x.x.x_x64_en-US.msi` | MSI 安装包 | ~7 MB |

### macOS / Linux

即将推出。

## 开发构建

### 环境要求

- Node.js 18+
- Rust 1.70+（[安装指南](https://rustup.rs/)）

### 开发模式

```bash
npm run tauri:dev
```

### 生产构建

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`

### 更新图标

```bash
npx @tauri-apps/cli icon app-icon.png
```

## 项目结构

```
src-tauri/
├── Cargo.toml          # Rust 依赖配置
├── tauri.conf.json     # Tauri 配置
├── icons/              # 应用图标
└── src/
    └── main.rs         # Rust 入口
```

## 配置说明

### tauri.conf.json

关键配置项：

```json
{
  "bundle": {
    "windows": {
      "webviewInstallMode": {
        "type": "embedBootstrapper",
        "silent": true
      }
    }
  },
  "plugins": {}
}
```

**注意：** Tauri 2.x 中，`plugins` 配置应为空对象 `{}`，插件在 Rust 代码中初始化。

### Cargo.toml

Release 优化配置：

```toml
[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

## 故障排除

### 应用无法启动（Exit Code 101）

通常是配置错误。检查：
1. `plugins` 是否为空对象
2. 重新构建：`cargo clean && npm run tauri:build`

### WebView2 问题

应用已内置 WebView2 bootstrapper，会自动安装。如仍有问题：
- 手动安装 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
- 确保 Windows 10 1803 或更高版本

### 构建失败

1. 更新 Rust：`rustup update`
2. 清理构建：`cd src-tauri && cargo clean`
3. 检查 Node.js 版本

## 更多文档

- [Tauri 后端说明](./src-tauri/README.md)
- [桌面功能](./docs/DESKTOP_FEATURES.md)
- [发布指南](./docs/MANUAL_RELEASE_GUIDE.md)
