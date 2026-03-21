# GitHub Deployment Guide

## Summary

Lattice 现在有两条发布路径：

- **GitHub Pages**：发布 `web-dist/`
- **Desktop Release**：发布 `releases/vX.Y.Z/` 中的桌面产物与元数据

平台侧如果出现 GitHub billing / Actions 不启动，不视为仓库内缺陷；仓库内的目标是保证：

1. 本地能独立完成完整发布闭环
2. GitHub Actions 恢复后可以复用同一套构建与元数据逻辑

## Pages Deploy

### 触发

- `push` 到 `main`
- `workflow_dispatch`

### 仓库内约束

- `next.config.ts` 使用 `output: "export"`
- 构建产物固定为 `web-dist/`
- workflow 必须校验 `web-dist/index.html` 存在

### 本地验证

```bash
npm install
npm run clean
npm run build
```

验证项：

- `web-dist/index.html` 存在
- `web-dist/` 内包含 diagnostics 与 guide 相关静态路由产物

## Desktop Release

### 推荐流程

```bash
npm install
npm run clean
npm run release:prepare
```

可选：

```bash
npm run release:prepare -- --skip-qa
npm run release:prepare -- --dry-run
npm run release:prepare -- --upload
```

其中 `--dry-run` 会把 `release-manifest`、`checksums` 和 `summary` 以 stdout payload 形式打印出来，适合在本地先检查版本、产物集合和 hash 是否符合预期。

### 产物闭环

`release:prepare` 负责：

1. 校验 `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 版本一致
2. 默认执行 `qa:gate`
3. 生成桌面产物
4. 同步到 `releases/vX.Y.Z/`
5. 生成：
   - `checksums.txt`
   - `release-manifest.json`
   - `RELEASE_SUMMARY.md`
6. 若启用 `--upload` 且 `gh` 已登录，则上传到 GitHub draft release

### GitHub Actions 角色

- `release.yml`
  - `workflow-lint`
  - `preflight`
  - `build-matrix`
  - `create-draft-release`
- Actions 只负责生成 **draft release**
- 是否正式 publish 仍保留人工确认

## Platform vs Repo Boundary

### 平台问题

- GitHub billing issue
- GitHub Pages / Releases 服务端不可用
- GitHub-hosted runner 资源波动

### 仓库内问题

- workflow artifact path 配置错误
- 发布脚本未生成 manifest / checksum / summary
- browser regression 不稳定
- release 文档与实际流程不一致

## Acceptance

发布工程被认为已收口，当：

- `npm run qa:gate` 通过
- `releases/vX.Y.Z/` 中有完整产物和元数据
- `release.yml` 能创建带元数据文件的 draft release
- `deploy.yml` 能基于 `web-dist/` 部署 Pages
