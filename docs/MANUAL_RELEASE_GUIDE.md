# 手动发布指南

适用版本：`v3.0.0`

## 1. 最小本地发布闭环

在项目根目录执行：

```bash
npm run release:prepare
```

这个命令默认会：

1. 校验版本一致性
2. 执行 `qa:gate`（其中已包含 `test:docs`）
3. 生成桌面产物
4. 验证安装包版本与 Windows 程序 ProductVersion，随后同步到 `releases/v3.0.0/`
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

# 同一阶段已通过完整 qa:gate，直接整理刚构建并验证过的产物，避免重复构建
npm run release:prepare -- --skip-qa --artifacts-dir src-tauri/target/release

# gh 已登录时，直接创建/更新 GitHub draft release
npm run release:prepare -- --upload
```

`--skip-qa` 只用于已经完成 `qa:gate` 或等价验证后的产物刷新；正式发布默认走 `npm run release:prepare`，保持产物、测试和 release 元数据同源。

`--dry-run` 返回 `verification: not-verified-dry-run`，只用于查看候选，不代表二进制已通过版本或功能验证。实际打包在清理输出目录前验证产物；不要将 `--output-dir` 指向已有用户数据目录。

桌面冒烟使用独立的 `LATTICE_DIAGNOSTICS_PROFILE` 和 `WEBVIEW2_USER_DATA_FOLDER`，PDF 脚本同时设 `LATTICE_DESKTOP_SMOKE_KEEP_EXISTING=1`，避免关闭用户正在运行的实例。仅覆盖 `APPDATA` 无法隔离 Windows Tauri 原生存储。

## 3. VS Code 兼容导入说明

当前桌面版支持导入常见 VS Code 工作区配置，并映射到 Lattice 内部设置：

- `settings.json`
- `keybindings.json`
- `snippets`
- `tasks.json`
- `.vscode/extensions.json` 推荐扩展
- 本机已安装扩展清单
- 已安装扩展的 `contributes.languages`
- 已安装扩展的 `contributes.snippets`
- 已安装扩展的命令、视图、菜单、Notebook、Notebook renderer、grammar、theme、调试器、名称、版本和分类元数据

用户路径应为真正一键导入：

1. 打开 `Settings / 设置`。
2. 进入 `Files / 文件`。
3. 点击 `Import from VS Code / 一键导入`。
4. Lattice 自动扫描本机 VS Code / VS Code Insiders 的标准配置与扩展目录。
5. 导入成功后自动启用兼容配置；之后打开任意文件夹时，代码工作台会继续使用已导入配置。

普通用户不需要上传 JSON，也不需要手动选择配置目录。`Reset / 重置` 会清空导入结果并关闭兼容配置。

导入成功后必须能在设置页看到配置来源、导入时间、扩展/任务/片段/文件关联统计、扩展贡献语言/命令/视图/Notebook/grammar/调试器统计，以及已识别扩展的名称和能力状态。打开可执行代码文件、只读代码文件、可编辑 `.ipynb` 或只读 `.ipynb` 后，内容区必须保持 Lattice 原生编辑或阅读体验，不显示 `VS Code Takeover / VS Code 接管` 顶部条。专用 VS Code 活动栏只显示已注册的 Host 命令、视图和按需可激活入口；扩展失败时必须显示具体扩展和错误。PDF、Markdown、图片和批注页面不得出现 VS Code 兼容界面。

导入后会生效的范围包括：

- 编辑器选项
- 文件关联
- Explorer 排除
- Workspace 搜索排除
- 代码片段补全
- VS Code task 执行，输出进入 Lattice Run 面板
- `.vscode/launch.json` 运行配置导入，并在代码工作台中可直接触发 launch
- 可执行代码文件和 `.ipynb` 的 VS Code 风格活动栏与插件/运行/Notebook 侧边面板
- 可执行代码文件和 `.ipynb` 的专用 VS Code 活动栏与本机 VS Code 打开入口，不覆盖内容区
- 只读代码浏览和只读 `.ipynb` 保持原生阅读体验，并向 Host 发送匹配的按需激活事件
- `.ipynb` 的 kernel/runtime/cell/problems 状态，以及可用时的 `Run All Cells / 运行全部单元`
- 扩展/插件清单、名称、版本、分类和能力映射状态
- 已安装扩展贡献的语言关联、snippet JSON、commands、views、menus、notebooks、notebook renderers、grammars 和 themes
- 桌面端受限 `Extension Host / 扩展宿主`，可对带 `main` 入口的已导入扩展执行激活，并只把实际注册的命令和视图接入 Lattice
- 当前宿主还支持 `workspace.getConfiguration()`、`workspace.fs`、`workspace.openTextDocument()`、`workspace.findFiles()`、`window.showTextDocument()`、`extensions.getExtension/all`、`Disposable`、`EventEmitter`、显式与贡献推导的 `onCommand` / `onView` / `onLanguage` / `onNotebook` 激活

当前已导入并识别 VS Code 扩展清单、语言贡献、片段贡献、视图/命令/Notebook/grammar/theme 贡献和元数据，并新增桌面端受限 Extension Host Bridge：可启动本地扩展宿主、激活带 `main` 入口的扩展，并把扩展命令接入工作台与命令面板。完整 VS Code Extension Host API、真实调试器接管、复杂 webview/notebook renderer 和远程 extension host 仍是后续兼容层工程。详细规划见 `docs/VS_CODE_COMPATIBILITY_PLAN.md`。

## 4. 版本一致性

以下版本号必须一致：

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

如果不一致，`prepare-release.mjs` 会直接失败。

## 5. 桌面构建验证

发布前至少确认：

- `npm run qa:gate` 全绿
- `tauri build` 输出中能看到：
  - `Patching binary ... for type msi`
  - `Patching binary ... for type nsis`
- 不再出现 `__TAURI_BUNDLE_TYPE variable not found in binary`

## 6. 产物目录

本地发布事实来源固定为：

- `releases/v2.3.2/`

其中至少应包含：

- `lattice.exe`
- `Lattice_2.3.1_x64_en-US.msi`
- `Lattice_2.3.1_x64-setup.exe`
- `checksums.txt`
- `release-manifest.json`
- `RELEASE_SUMMARY.md`

`release-manifest.json` 会记录 `gitRevision` 与 `gitDirty`。如果 `gitDirty` 为 `true`，说明本地产物来自带有未提交改动的工作区；正式发布前应在完成提交后重新执行 `npm run release:prepare`，让产物和提交版本一一对应。

## 7. GitHub Release

如果平台可用且 `gh` 已登录：

```bash
npm run release:prepare -- --upload
```

如果平台不可用或 billing 有问题：

- 保留本地 `releases/v2.3.1/` 作为可交付结果
- 平台恢复后再执行 upload

## 8. 最低验收

- `/diagnostics/pdf-regression` 可通过
- `/diagnostics/image-annotation` 可通过
- `/diagnostics/selection-ai` 可通过
- `/diagnostics/runner` 可打开并展示解释器/命令探测结果
- `/performance-test` 可完成三项性能基线并显示 0 个失败项
- `npm run test:browser-regression` 全绿
- Windows 桌面端启动后不再出现原生标题栏与自定义标题栏双排
- Windows 标题栏最右侧的最小化 / 最大化 / 还原 / 关闭按钮在窄宽度下仍可见且可用
- 最近工作区重开前会检查路径有效性，失效路径应从最近列表移除
- 工作区恢复后，应继续恢复上一次的 pane / split / tab 结构与活跃标签
- 代码文件、Notebook code cell、Markdown code block 都能看到 `Run / Problems` 分层反馈
- Notebook 不应再保留独立顶部动作条，高频动作应统一进入 `Command Bar`
- 打开任意 PDF 后，Explorer 中只投影真实用户笔记 / Notebook；未产生批注前不应默认出现 `_annotations.md`
- PDF 左栏应表现为紧凑单栏：条目工作区为可折叠 section，批注搜索/筛选/多选不应再形成第二套网页式工具台
- 新增一条 PDF 批注后，`.lattice/items/<fileId>/_annotations.md` 会惰性生成并自动同步
