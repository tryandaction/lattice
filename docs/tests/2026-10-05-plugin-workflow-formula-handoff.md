# 插件与公式交接（2026-10-05）

## 当前状态

插件运行时、可安装包、公式提取工作流和真实浏览器路径已完成实现，交付版本为 `3.1.0`。源码已冻结，主窗口正在执行完整 `qa:gate`；本窗口不再修改产品源码、测试、脚本、公共资源、Rust 或配置。

## PluginsPanel 接入

主窗口把现有 settings-dialog 插件主体替换为：

```tsx
<PluginsPanel
  onOpenGuide={openPluginGuide}
  onPluginsChanged={refreshSettings}
/>
```

详见 `src/components/settings/plugins-panel.tsx` 导出的 `PluginsPanelProps`。共享的 settings-dialog、i18n、PDF adapter、Rust 文件由主窗口接入，本窗口不直接修改。

## 验证边界

浏览器验证使用独立 `NEXT_DIST_DIR=web-dist-dev-plugins` 和独立端口；不启动桌面产品。pix2tex 仅在 Tauri + 用户已安装后端时可用，Web 环境应明确显示不可用而不是伪造零结果。

## 本轮实现

- `src/components/settings/plugins-panel.tsx`：插件中心最小可接入面板，展示已注册/已安装插件、启用状态、runtime 错误和最近诊断事件；支持启用、停用、卸载、刷新。
- `src/lib/plugins/runtime.ts`：激活异常回滚已注册资源；停用 hook 抛错时仍执行命令、面板、UI、资源清理；同步时单插件失败不阻塞其他插件。
- `src/plugins/formula-extractor/index.ts`：扫描/OCR 任务绑定 active document identity 和 generation，切文件或停用后丢弃过期结果；OCR 置信度只接受后端可选证据，缺失时标记为保守值并保持 review。
- `src/lib/formula-ocr.ts`：兼容后端可选 confidence 字段。
- `src/lib/plugins/worker-host.ts`：Worker 的 load/activate/deactivate/runCommand 均有 request acknowledgement；启动只在 load+activate 成功后监听活动文件，停止会等待 deactivate 并拒绝剩余操作。
- `src/stores/plugin-store.ts`：安装、更新、卸载均处理同 ID 的启用/信任授权；替换前先撤销授权并停用现有实例。只有在写包开始前失败才恢复旧授权；写包开始后的失败保持目标 ID disabled/untrusted，等待用户重试。
- 写包事务已收敛：localStorage 使用临时键提交并在失败时恢复旧 bundle/index；OPFS 使用最后写入的 commit marker，部分写入失败会恢复旧 manifest/main/meta 或删除不完整目录，不再悄悄 fallback 到另一存储后端。installer 通过 `onStoreStart` 标记写入边界，写入开始后的错误保持目标 ID disabled/untrusted。
- OPFS 格式兼容：旧版本完整目录（无 marker、无 pending，且 manifest/main/meta 校验通过）会在读取时迁移补写 commit marker；本版本写入先写 `pending.json`，pending 存在且 commit 缺失时始终拒绝加载。commit 的 `id/version` 必须与 manifest 一致；资源读取也经过同一提交检查。
- `src/lib/plugins/pdf-geometry.ts`：从 PDF text model、原始 glyph 和绘制规则构造插件页数据，保留 viewport 尺寸、bbox、字号、baseline 和分数线等信息。
- `src/plugins/formula-extractor/workflow.ts`：统一 document/current-page/selection 范围、进度、取消、重试、文档 revision 绑定、编辑后复制/导出/定位。
- `docs/examples/plugins/hello-plugin`：可直接导入或压缩为 ZIP 的最小安装包示例。
- `PluginsPanel` 已修复 Install ZIP 点击未调用函数；安装成功只进入已安装列表，默认不信任/不启用，需在详情中明确授权。
- manifest settings 支持 string/number/boolean/select，使用本地受控状态 + runtime KV 持久化；写入失败显示可恢复错误并撤销本地值；重开面板会 hydrate 已存值。
- 详情面板显示权限风险、信任开关和 manifest commands；命令调用走 `runPluginCommand`，错误反馈到面板。
- 公式结果面板支持 LaTeX 编辑、渲染即时预览，复制命令带 corrected latex，批量导出读取 corrected map；支持 progress/cancel/retry 命令状态。
- `PluginPdfTextPage.items` 增加可选 `fontSize`/`baseline`/`mathAxis`/`ruleKind`，runtime 在可用时透传；extractor 仅在明确单字符 geometry 且 baseline 存在时调用 `inferPdfFormulaFromSelection`，不确定结果保持 review。

## 验证结果

最终验证已通过：15 个 focused test files、80/80 tests；`npx tsc --noEmit --pretty false`；插件归属 ESLint `--max-warnings=0`；`node scripts/check-docs.mjs` 检查 138 个文件。覆盖同 ID ZIP/目录替换、main/asset 写入故障、OPFS legacy/pending、资源树回滚、FSA 导出、双 pane reveal、生命周期和公式结构。

独立开发服务器已使用 `NEXT_DIST_DIR=web-dist-dev-plugins`、`http://127.0.0.1:3417` 启动并返回 HTTP 200。真实页面已验证：中文插件中心、内置公式提取运行状态、权限/设置/OCR 状态、真实命令打开结果面板、3 条 PDF 原生公式、公式编辑和 Markdown 复制。复制结果示例为 `$$x^{2}=\\frac{2a}{b}$$`。

旧浏览器验证曾发现 `showSaveFilePicker` 拒绝带 charset 的 MIME；运行时已将 picker 类型规范化为裸 MIME 类型，回归测试确认 picker 收到裸 MIME、Blob 仍保留 charset。真实页面导出仍受浏览器原生保存对话框控制，已通过 runtime adapter 和权限拒绝路径验证。

## 最终真实页面回归

在 `http://127.0.0.1:3417/diagnostics/skins-plugins` 的真实浏览器页面中重新加载 `plugin-formulas.pdf`：

- 公式提取结果显示 3 条公式，分别为 `x^{2}=\\frac{a}{b}`、矩阵和 `E=mc^{2}`；结果面板提供 LaTeX 编辑框、复制和 `.md/.tex` 导出按钮。
- 在扩展设置点击“停用”后，插件结果 dock 变为“暂无插件面板”，插件状态显示“已停用”；这验证了 command/panel/UI 清理路径。
- 点击“启用”后，结果 dock 和“识别公式”入口恢复，状态显示“运行中”；没有重复面板。
- 该 IAB 页面未暴露 `showSaveFilePicker`，因此真实页面走下载 fallback；原生 FSA 参数由 `plugin-export.test.ts` 直接 mock 浏览器 API 验证。

## 同 ID 安装替换验收结果

安装器回归测试使用真实 JSZip payload，并验证以下顺序：

1. 预置 `enabledPlugins: [target, other]`、`trustedPlugins: [target, other]`，并让 target 实例处于 active。
2. 安装同一 `target` ID 的新 ZIP，断言先调用停用，再持久化移除 target 授权；`other` 的授权保持不变。
3. 断言新 manifest/main 已存储，但 target 仍未信任、未启用，不会在本次安装中自动重新激活。
4. 让 `updateSettings` 返回 `false`，断言安装被拒绝、旧授权保持、旧包仍可恢复，且不写入新包。
5. 让停用失败，断言旧授权恢复；让写包开始后失败，断言目标 ID 保持 disabled/untrusted，旧包或完整回滚包不会混读，且不会留下 active worker、command、panel 或监听器。

目录安装应复用同一事务回调；卸载应先撤销授权并停用，删除失败时恢复授权。测试不得只使用全新 ID，否则无法覆盖默认信任或旧包替换回归。

## 当前 PDF geometry 接入状态

生产 runtime 已从 PDF.js text model、原始 glyph 和绘制规则构造 `PluginPdfTextPage`，保留 viewport 尺寸、归一化 bbox、字号、baseline、math axis 和 fraction rule 信息；公式 extractor 在 geometry 证据完整时调用现有结构推断，否则保留原始内容并标记 review。该接入已包含在上述 80 个 focused tests 和真实 PDF 浏览器验证中，没有待补字段或待解决的类型阻塞。
