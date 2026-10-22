# Lattice VS Code 代码语言能力桥接设计

## 状态

方案 A/A1 的实现设计。目标是让导入的 VS Code 插件对 Lattice 的代码编辑产生真实作用，同时保留 Lattice 的文件、PDF、Markdown、笔记、AI 和执行工作流。该设计不把完整 VS Code Workbench 嵌入 Lattice，也不宣称任意 Marketplace 插件已经兼容。

## 问题与现状

Lattice 当前使用 CodeMirror 作为代码编辑器，并已有内置 TypeScript、Python、Rust 分析服务。Node Extension Host 已经可以加载一部分本地 CommonJS 插件，且已经支持命令、Tree View、Webview、文档对象和若干 `vscode.languages` 注册入口。

当前的关键断点是：语言 Provider 只被保存到宿主注册表，宿主没有对外提供按文档和位置调用 Provider 的请求协议；CodeMirror 也没有订阅这些 Provider。因此插件可以显示图标或进入激活状态，但不会自动产生补全、悬停、跳转、诊断、重命名、代码操作或格式化效果。

## 产品契约

打开 `.ts`、`.js`、`.py`、`.rs` 等代码文件时：

1. 用户仍停留在 Lattice 当前工作区，不需要在第二个 VS Code 窗口重新打开文件夹。
2. CodeMirror 保持当前 Lattice 的编辑、保存、运行、调试和问题面板。
3. 已激活且注册了语言 Provider 的本地 VS Code 插件，可以对当前文档提供真实的代码能力。
4. 内置语言服务和插件 Provider 通过统一聚合器合并结果；单个 Provider 失败或超时不会阻塞编辑器。
5. 侧栏显示 Provider 的来源、响应状态、耗时和缺失 API，避免“有图标但实际不可用”。

第一阶段必须闭环的能力：Completion、Hover、Definition、Diagnostics。第二阶段在相同协议上加入 Reference、Rename、CodeAction 和 Formatting。协议从第一天保留可扩展的 feature 名称，但未实现的 feature 必须返回明确的 `unsupported`，不能伪造成功。

## 方案比较

### 方案 A：语言能力桥接层（采用）

在现有 Node Extension Host 与 CodeMirror 之间增加文档同步、Provider RPC 和编辑器扩展。优点是能直接改善代码体验、保持 Lattice 外壳、复用现有内置语言服务和调试状态；风险是只能覆盖宿主 API 和插件自身实现不依赖的能力，需要明确兼容边界。

### 方案 B：只接入 Code-OSS/Monaco 编辑器内核

把代码区域迁移到更接近 VS Code 的编辑器内核，但仍自行实现宿主和插件桥接。优点是编辑器行为更接近 VS Code；风险是迁移成本大、会破坏当前 CodeMirror 工作流，且不能单独解决插件依赖 Language Client、终端、Electron 或独立语言服务的问题。

### 方案 C：完整 Code-OSS Workbench

把代码区域交给完整 Code-OSS Workbench。优点是兼容面最大；风险是体积、启动时间、跨窗口状态和 Lattice 文档工作流都会明显变差，与用户要求的“只让代码浏览像 VS Code，周边仍是 Lattice”相冲突。本阶段不采用。

## 运行时架构

### 1. 文档同步

前端为每个活动代码文档维护 `{ uri, fileName, languageId, version, text }`。打开时发送 `open-document`；编辑时以 150ms 防抖发送 `change-document`，保存时发送 `save-document`。版本单调递增，旧响应不得覆盖新版本。

宿主的 `TextDocument` 必须根据同步快照返回稳定的 `version`、`languageId`、`lineAt`、`getText` 和 URI。不存在于工作区边界内的文件拒绝同步。

### 2. Provider 注册

宿主登记以下 Provider 元数据：

- `feature`: `completion | hover | definition | reference | rename | codeAction | formatting | diagnostics`
- `selector`: 语言 ID、glob 或文档过滤器
- `extensionId`、注册顺序、触发字符
- 可销毁句柄和最近一次状态

注册 API 必须返回真实 `Disposable`。停用扩展或文档变化时销毁句柄，不能留下重复 Provider。

### 3. Provider RPC

新增受控请求：`language-feature`。请求包含 `feature`、文档 URI、文档版本、位置或范围、可选触发字符和取消标识。宿主按 VS Code 选择器过滤 Provider，调用 Provider 方法，并把结果映射为 JSON 可序列化的稳定结构。

响应包含：`ok`、`feature`、`documentVersion`、`results`、每个 Provider 的 `extensionId`、耗时和错误/超时状态。Provider 异常隔离；单次调用上限 1200ms，连续超时的 Provider 进入冷却状态并在侧栏提示。

结果映射只接受 VS Code 官方数据形状的必要子集：CompletionItem、Hover、Location/LocationLink、Diagnostic、TextEdit、CodeAction。未知字段丢弃，路径必须是绝对路径或受信任工作区内 URI。

### 4. CodeMirror 聚合器

新增 `vscode-language-bridge` 编辑器扩展，提供：

- Completion source：按语言和触发字符请求插件 Provider，并合并内置 snippets/语言服务结果。
- Hover tooltip：并行请求 Hover Provider，合并 Markdown/纯文本内容。
- Ctrl/Cmd+Click 与 F12：请求 Definition，选择第一个受信任位置并调用 Lattice 的现有文件导航。
- Diagnostics：将宿主 Diagnostic 转换为 CodeMirror lint 诊断，同时保留来源用于 Problems 面板。

第二阶段扩展：

- F2 Rename：预览并原子应用多文件 TextEdit。
- CodeAction：在光标和诊断处显示可执行修复。
- Formatting：只应用工作区内 TextEdit，并遵守 `editor.formatOnSave`。
- References：复用现有 References dock。

所有请求都必须检查活动文档版本；响应版本落后时直接丢弃。

## 性能与稳定性

- 宿主进程只启动一次，代码文件打开不重新启动 Extension Host。
- 文档变更采用 150ms 防抖，连续输入期间不为每个字符启动进程。
- Completion/Hover 使用 500ms UI 等待窗口；Definition/Diagnostics 使用 1200ms 宿主上限。
- 同一文档同一 feature 只允许一个在途请求，新请求取消旧请求。
- 宿主 stdout 继续保持单行 JSON 协议，插件日志重定向到 stderr。
- 单个插件异常只影响该 Provider；宿主整体不能因为插件异常退出。

## 安全边界

- 只执行用户从本机导入的扩展路径，不从网络下载或自动安装插件。
- 所有文档、Location 和 TextEdit 路径必须位于当前工作区，除非用户明确批准外部文件。
- 不在渲染器直接执行插件 JavaScript。
- 不默认开放任意 `child_process`、终端、Electron remote、任意调试适配器或网络权限。
- 记录真实缺失 API，不用兼容图标掩盖不可用状态。

## 明确支持边界

本阶段目标是支持“能在 Extension Host 内直接注册语言 Provider”的本地 CommonJS 插件。依赖 `vscode-languageclient`、Pylance、Rust Analyzer、ESLint server、Volar 或自带后台语言服务的插件，只有在其服务进程和协议另行接入后才算支持，不能因为扩展清单可见就视为已支持。

Webview、Tree View、命令和调试贡献继续沿用现有桥接；本设计不把它们误报为语言能力。完整 LSP 路由、远程开发、浏览器调试、扩展终端和多会话调试属于后续单独设计。

## 测试与验收

1. 宿主单元测试：Provider 注册/销毁、selector 匹配、请求序列化、超时、取消、异常隔离和路径边界。
2. 前端单元测试：文档版本、去抖、旧响应丢弃、Completion/Hover/Definition/Diagnostic 映射和 CodeMirror 扩展行为。
3. 真实夹具插件：至少注册 completion、hover、definition、diagnostics，并在一个 `.ts` 文件中返回可见结果；保存后验证文档事件。
4. 桌面 smoke：从本地扩展目录导入，打开已有工作区代码文件，确认无需重新选目录即可完成激活、补全、悬停、跳转和问题显示。
5. 性能门槛：首次启动不新增可感知的重复宿主启动；连续输入不产生请求风暴；Provider 超时后编辑器仍可编辑。
6. 通过 typecheck、聚焦 Vitest、Rust 测试、docs 检查、生产构建、Tauri 构建和 release 产物校验后，才刷新 `releases/v2.3.1`。

## 后续路线

- A1.1：宿主 `language-feature` RPC 与文档同步。
- A1.2：CodeMirror Completion/Hover/Definition/Diagnostics 聚合器。
- A1.3：真实夹具插件和桌面 smoke。
- A1.4：Reference/Rename/CodeAction/Formatting。
- A2：LSP client routing，逐个验证 Pylance、Rust Analyzer、ESLint 等真实扩展依赖。
