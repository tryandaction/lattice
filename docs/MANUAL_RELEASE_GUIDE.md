# 手动发布指南

适用版本：`v2.0.0`

本文档用于在本地手动准备桌面版发布产物，并同步到仓库内的发布目录。

## 1. 构建前检查

在项目根目录执行：

```bash
npm install
npm run lint
npm run typecheck
npm run test:run
npm run test:browser-regression
npm run build
npm run tauri:build
```

预期产物：

- `src-tauri/target/release/lattice.exe`
- `src-tauri/target/release/bundle/msi/Lattice_2.0.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Lattice_2.0.0_x64-setup.exe`

## 2. 同步发布目录

将最新构建结果复制到仓库发布目录：

- 目标目录：`releases/v2.0.0/`

需要同步的文件：

- `lattice.exe`
- `Lattice_2.0.0_x64_en-US.msi`
- `Lattice_2.0.0_x64-setup.exe`

同步后建议检查：

- 文件大小是否发生更新
- 修改时间是否为本次构建时间
- `docs/RELEASE_NOTES.md` 是否与本次发布内容一致

## 3. GitHub Releases

如果要发布到 GitHub Releases：

1. 创建或编辑标签 `v2.0.0`
2. 上传 `releases/v2.0.0/` 中的三个文件
3. 将 `docs/RELEASE_NOTES.md` 中的内容整理到 Release 描述

推荐上传：

- `Lattice_2.0.0_x64-setup.exe`
- `Lattice_2.0.0_x64_en-US.msi`
- `lattice.exe`

## 4. 验证清单

发布前至少确认以下项目：

- 应用可以正常启动
- 桌面端可以打开工作区并恢复最近工作目录
- `.py` 文件可以在桌面端使用本地 Python 运行
- Notebook 单元在桌面端可以连续运行并保留上一个单元的变量
- 桌面端如果探测到本地 Python，Notebook 运行器默认不会继续停留在 Pyodide 回退项
- 桌面端如果只能使用 Pyodide，会明确显示为“应急回退”，而不是伪装成本地主运行器
- `/diagnostics/pdf-regression` 可以正常打开，并能完成 PDF 双分屏基础回归
- `/diagnostics/image-annotation` 可以正常打开，并能完成真实 workspace handle 图片标注回归
- `/diagnostics/selection-ai` 可以正常打开，并能完成 Chat / Agent / Plan 三种 diagnostics provider override 主链路回归
- PDF 首次打开默认会以 `适宽` 填充阅读区
- PDF 放大、缩小、适宽不会跳回第一页
- 分屏打开两个 PDF 时，`Ctrl+滚轮` / 缩放快捷键只作用于当前 pane
- 分屏收缩后，右侧 pane 内容不会超出屏幕边界
- 在同一窗口内切换到其他已打开文件再切回，PDF 阅读进度与缩放状态仍能恢复
- PDF 文本选区显示为淡蓝色
- Selection AI Hub 能区分 `快速问答 / 深度分析 / 计划生成`
- Selection AI Hub 支持最近模式、starter templates、最近 prompt 历史和键盘快捷键
- Markdown 编辑器可以直接导出 `.docx` 与 `.pdf`
- Markdown 导出的 `clean` / `appendix` / `study-note` 模式可正常工作
- Markdown 导出的“文档版式”与“当前渲染视图”都能正常出文件
- 外部网页链接会打开系统浏览器
- 文件树支持复制、剪切、粘贴和拖放移动
- 目录重命名或移动后，已打开标签仍然有效

## 5. 已知非阻塞警告

当前 Tauri bundler 仍会输出：

```text
Failed to add bundler type to the binary: __TAURI_BUNDLE_TYPE variable not found in binary
```

这不会阻塞本次构建或安装包生成，但如果后续要做自动更新链路，建议单独处理。

额外说明：

- 当前 browser regression 已覆盖 PDF 双分屏、图片 workspace handle 标注、Selection AI 三条主链路。
- 对于 PDF 深页切文件切回后的可见页位置，发布前仍建议在 `/diagnostics/pdf-regression` 手工复检一次。
