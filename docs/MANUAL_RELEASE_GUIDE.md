# 手动发布指南

适用版本：`v2.1.0`

## 1. 最小本地发布闭环

在项目根目录执行：

```bash
npm install
npm run clean
npm run release:prepare
```

这个命令默认会：

1. 校验版本一致性
2. 执行 `qa:gate`（其中已包含 `test:docs`）
3. 生成桌面产物
4. 同步到 `releases/v2.1.0/`
5. 生成：
   - `checksums.txt`
   - `release-manifest.json`
   - `RELEASE_SUMMARY.md`

如果还要同步当前 Web 站点到 Cloudflare Pages，直接执行：

```bash
npm run deploy:web
```

## 2. 常用模式

```bash
# 跳过整套 QA，只做桌面构建和元数据整理
npm run release:prepare -- --skip-qa

# 仅做检查和产物扫描，不写文件；会把 manifest/checksums/summary 作为 stdout payload 打印出来
npm run release:prepare -- --dry-run

# gh 已登录时，直接创建/更新 GitHub draft release
npm run release:prepare -- --upload
```

## 3. 版本一致性

以下版本号必须一致：

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

如果不一致，`prepare-release.mjs` 会直接失败。

## 4. 桌面构建验证

发布前至少确认：

- `npm run qa:gate` 全绿
- `tauri build` 输出中能看到：
  - `Patching binary ... for type msi`
  - `Patching binary ... for type nsis`
- 不再出现 `__TAURI_BUNDLE_TYPE variable not found in binary`

## 5. 产物目录

本地发布事实来源固定为：

- `releases/v2.1.0/`

其中至少应包含：

- `lattice.exe`
- `Lattice_2.1.0_x64_en-US.msi`
- `Lattice_2.1.0_x64-setup.exe`
- `checksums.txt`
- `release-manifest.json`
- `RELEASE_SUMMARY.md`

## 6. GitHub Release

如果平台可用且 `gh` 已登录：

```bash
npm run release:prepare -- --upload
```

如果平台不可用或 billing 有问题：

- 保留本地 `releases/v2.1.0/` 作为可交付结果
- 平台恢复后再执行 upload

## 7. 最低验收

- `/diagnostics/pdf-regression` 可通过
- `/diagnostics/image-annotation` 可通过
- `/diagnostics/selection-ai` 可通过
- `/diagnostics/runner` 可打开并展示解释器/命令探测结果
- `npm run test:browser-regression` 全绿
- Windows 桌面端启动后不再出现原生标题栏与自定义标题栏双排
- Windows 标题栏最右侧的最小化 / 最大化 / 还原 / 关闭按钮在窄宽度下仍可见且可用
- 最近工作区重开前会检查路径有效性，失效路径应从最近列表移除
- 工作区恢复后，应继续恢复上一次的 pane / split / tab 结构与活跃标签
- 代码文件、Notebook code cell、Markdown code block 都能看到 `Run / Problems` 分层反馈
- Notebook 不应再保留独立顶部动作条，高频动作应统一进入 `Command Bar`
- 打开任意 PDF 后，Explorer 中只投影真实用户笔记 / Notebook；未产生批注前不应默认出现 `_annotations.md`
- PDF 左栏应表现为紧凑单栏：条目工作区为可折叠 section，批注搜索/筛选/多选不应再形成第二套网页式工具台
- 新增一条 PDF 批注后，`.basename.lattice/_annotations.md` 会惰性生成并自动同步
