# Lattice VS Code 代码语言能力桥接实施计划

> 实施要求：严格 TDD。每个切片先新增失败测试，再实现最小行为，最后运行聚焦测试。

## 切片 1：宿主数据模型与 RPC

**目标文件**

- `src/lib/vscode-extension-host/types.ts`
- `src/lib/vscode-extension-host/desktop.ts`
- `src/lib/vscode-extension-host/__tests__/desktop.test.ts`
- `src-tauri/src/main.rs`

**步骤**

1. 定义文档同步、语言 Feature 请求、Provider 状态和稳定结果类型。
2. 为 `open-document` 增加版本、语言 ID 和文本；新增 `change-document`、`save-document`、`language-feature` 请求。
3. 在宿主脚本中建立文档快照、selector 匹配、Provider 调用、超时和错误隔离。
4. 为 Completion、Hover、Definition、Diagnostics 编写序列化测试；所有未知结果字段安全丢弃。

## 切片 2：前端语言桥接

**目标文件**

- `src/lib/vscode-compat/language-bridge.ts`
- `src/lib/vscode-compat/__tests__/language-bridge.test.ts`
- `src/lib/vscode-extension-host/desktop.ts`

**步骤**

1. 实现文档版本和 150ms 防抖同步器。
2. 实现请求去重、取消和过期响应丢弃。
3. 合并宿主 Provider 与现有 TypeScript/Python/Rust 服务结果。
4. 把宿主诊断映射为现有 Problems/CodeMirror lint 数据。

## 切片 3：CodeMirror 编辑器接入

**目标文件**

- `src/lib/vscode-compat/editor-language-bridge.ts`
- `src/lib/vscode-compat/__tests__/editor-language-bridge.test.ts`
- `src/components/renderers/code-editor-viewer.tsx`
- `src/components/editor/codemirror/code-editor.tsx`（仅在需要暴露文档事件时修改）

**步骤**

1. 接入 Completion source 与触发字符。
2. 接入 Hover tooltip 和 Ctrl/Cmd+Click/F12 定义跳转。
3. 接入诊断 lint 与来源标识。
4. 保持当前 Lattice 保存、运行、调试、问题面板和导航行为不变。

## 切片 4：真实夹具与桌面 smoke

**目标文件**

- `src-tauri/tests/fixtures/vscode-language-provider-extension/`
- `src-tauri/src/main.rs` 测试模块
- `src/lib/vscode-extension-host/__tests__/language-feature.test.ts`

**步骤**

1. 创建本地 CommonJS 夹具插件，注册 completion、hover、definition 和 diagnostics。
2. 打开固定 `.ts` 文件，验证真实宿主调用和返回结果。
3. 修改并保存文件，验证版本单调、旧响应丢弃和文档事件。
4. 运行 opt-in desktop smoke，确认插件失败不阻塞编辑器。

## 切片 5：第二阶段能力

在第一阶段真实 smoke 通过后，再实现 Reference、Rename、CodeAction、Formatting。每项能力必须有多文件路径边界、原子应用和撤销测试，不与第一阶段混合发布。

## 验证顺序

1. 聚焦 Vitest（线程池、单文件）。
2. Rust `cargo test` 相关模块。
3. `npm run typecheck`、`npm run test:docs`、ESLint 和生产构建。
4. `npm run tauri:build`、release 准备和独立 SHA-256 校验。

## 交付边界

第一阶段完成后，只能声明“直接注册语言 Provider 的本地 CommonJS 插件具备代码 Provider 闭环”。不能声明 Pylance、Rust Analyzer、ESLint、Volar、远程开发、终端、任意调试适配器或完整 VS Code Marketplace 兼容，除非后续 LSP/服务进程适配分别通过真实测试。
