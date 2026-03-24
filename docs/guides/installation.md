# Lattice 安装与更新指南

## 1. 用户安装

### Web

直接访问：<https://lattice-apq.pages.dev/>

### Desktop

- 从 GitHub Releases 下载最新版本
- Windows 推荐优先使用 NSIS 安装包
- 本地发布准备完成后，桌面产物会同步到 `releases/vX.Y.Z/`

当前 `v2.1.0` 的本地产物示例：

- `releases/v2.1.0/Lattice_2.1.0_x64-setup.exe`
- `releases/v2.1.0/Lattice_2.1.0_x64_en-US.msi`
- `releases/v2.1.0/lattice.exe`

## 2. 开发环境要求

- Node.js 20+
- npm
- Rust stable
- Windows 桌面构建需要可用的 Tauri 2 工具链

## 3. 本地开发

### Web

```bash
npm install
npm run dev
```

### Desktop

```bash
npm install
npm run tauri:dev
```

## 4. 构建与验证

### Web 构建

```bash
npm run build
```

验证后应至少确认：

- `web-dist/index.html` 存在
- `web-dist/guide/index.html` 存在
- `web-dist/diagnostics/index.html` 存在

### Desktop 构建

```bash
npm run tauri:build
```

### 完整门禁

```bash
npm run qa:gate
```

## 5. 发布准备

```bash
npm run release:prepare
```

常用变体：

```bash
npm run release:prepare -- --dry-run
npm run release:prepare -- --skip-qa
npm run release:prepare -- --upload
```

如需直接把当前静态站点发布到 Cloudflare Pages：

```bash
npm run build
npx wrangler pages deploy web-dist --project-name lattice
```

## 6. 故障排查

### `tauri build` 失败

先确认：

- `npm run typecheck` 通过
- `npm run test:run` 通过
- `npm run build` 通过

再检查：

- Rust 工具链是否正常
- `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json` 版本是否一致
- 是否还能看到 `Patching binary ... for type msi/nsis`

### 本地 Python / Node / Julia / R 不可用

- 打开 `/diagnostics/runner`
- 在桌面端打开 Workspace Runner Manager
- 确认解释器路径、PATH、缺失依赖建议

## 7. 相关文档

- [快速开始](./quick-start.md)
- [用户指南](../USER_GUIDE.md)
- [桌面功能](../DESKTOP_FEATURES.md)
- [桌面构建与产物指南](./desktop-app.md)
- [手动发布指南](../MANUAL_RELEASE_GUIDE.md)
