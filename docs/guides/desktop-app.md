# Lattice 桌面构建与产物指南

这份文档面向开发者与发布维护者，关注桌面构建、产物位置和验收要点。若你想看桌面功能本身，请转到 [桌面功能指南](../DESKTOP_FEATURES.md)。

## 1. 当前桌面基线

- Tauri 2.x
- 桌面端默认优先本地运行器
- Runner Manager 与 Runner Diagnostics 已进入主链路
- PDF 条目工作区 v2 已进入主链路
- `qa:gate` 已把桌面构建纳入最终门禁

## 2. 常用命令

### 本地开发

```bash
npm run tauri:dev
```

### 桌面构建

```bash
npm run tauri:build
```

### 本地发布准备

```bash
npm run release:prepare
```

## 3. 产物位置

### 原始构建产物

- `src-tauri/target/release/lattice.exe`
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*.exe`

### 本地发布事实来源

- `releases/vX.Y.Z/`

其中应包含：

- 安装包/可执行文件
- `checksums.txt`
- `release-manifest.json`
- `RELEASE_SUMMARY.md`

## 4. 发布前最低验收

- `npm run qa:gate` 全绿
- `/diagnostics/pdf-regression` 可打开
- `/diagnostics/image-annotation` 可打开
- `/diagnostics/selection-ai` 可打开
- `/diagnostics/runner` 可打开
- `tauri build` 输出中仍可看到：
  - `Patching binary ... for type msi`
  - `Patching binary ... for type nsis`

## 5. GitHub Release 与 Pages 的关系

- 桌面 draft release 由 `release.yml` 负责
- 当前线上站点优先发布到 Cloudflare Pages：`https://lattice-apq.pages.dev/`
- GitHub Pages 使用同一个 `web-dist/` 作为备用/镜像链路
- 平台侧若因 billing 或 Actions 不可用而阻塞，不影响本地 `release:prepare` 闭环

## 6. 继续阅读

- [桌面功能指南](../DESKTOP_FEATURES.md)
- [安装与更新指南](./installation.md)
- [GitHub 部署指南](./github-deploy.md)
- [手动发布指南](../MANUAL_RELEASE_GUIDE.md)
