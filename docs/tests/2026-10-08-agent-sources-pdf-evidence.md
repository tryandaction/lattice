# AI 授权源与 PDF 子文件验收证据

日期：2026-10-08。依据 `docs/development-prompts/2026-10-08-agent-context-harness.md` 与对应设计、计划，继续既有实现收尾；保留共享工作区全部现存修改。

## 症状、确认根因与最终行为

| 症状 | 已确认根因 | 最终行为与证据 |
| --- | --- | --- |
| 用户输入未完成的 `%` mention 时源选择解析抛出 `URIError` | local/cloud parser 直接解码整个匹配结果 | 逐条容错，跳过坏编码，保留有效选择与原始正文；`invalidSourceSelectionMentions` / `invalidCloudSourceSelectionMentions` 返回可恢复提示所需 token。两条 parser 失败回归先红后绿。 |
| 云 mention 可能进入本地文件捕获 | 通用文件 mention 未区分 `@cloud:` 命名空间 | local parser 与实际 capture 排除 cloud/folder token；授权文件 resolver 拒绝 cloud URI/resource identity。真实 capture 混合坏编码、cloud/local mention 回归先红后绿。 |
| 小读取预算被并发批次放大 | 每个并发读取都被至少分配一个字符/单元 | 批次大小受剩余字符和单元共同约束，搜索返回实际读取范围和未完成覆盖。失败回归从 4 字符超出 2 字符预算变为不超额。 |
| 空目录树没有文件数上限可触发的停止条件 | 仅限制可读文件个数 | local index 具有目录/条目发现预算，cloud selection 具有 `maxFolders` / `maxEntries`；达到预算明确要求缩小选择或分页检索；失败回归先红后绿。 |
| 与工作区同名的子目录可能扩大授权 | `workspace/notes` 同时允许原路径和去掉根名的路径，读取时未解析选中目录 | 解析实际选中目录及实际文件位置后再进行授权；歧义选择拒绝，不能读取另一 `notes/private.txt`；失败回归先红后绿。 |
| 同一 provider 对象切换 scope 后仍可读已提取内容 | 读取闭包仅检查可选 pointer callback，未固定 `provider.scope` | 固定 scope，读取前后重验；账号/provider 撤销、role 与版本变化均使 snapshot 失效。scope mutation 失败回归先红后绿。 |
| 审批可被复用于修改后的 PDF 父路径 | 提案 hash 未包含父路径 | hash 绑定父路径、具体内容、目标、sourceRefs、plannedWrites 和版本；应用前重读 manifest 身份。错误审批、修改提案、替换 manifest、同名 PDF 均拒绝。失败回归先红后绿。 |
| 云生成提案时可能把旧分析套到新父版本 | prepare 重读父文件但接受任意最新版本 | prepare 对照传入父身份、版本与内容 fingerprint，版本变化必须重新读取和生成；失败回归先红后绿。 |
| 已删除云数据子文件仍可更新 | 子项关系检查只看 id | prepare/apply 都要求子项属于同库、仍为 active，应用同时重验子项身份、文件名、版本、内容；失败回归先红后绿。 |
| 本地数据子文件在打开 writable 后被外部编辑仍会覆盖 | expectedContent 只在准备写入前核验一次 | close 前重读原文件与父 PDF，发生冲突 abort writable，保留外部内容；失败回归先红后绿。 |

## 源读取与引用

- `createAuthorizedSourceIndex` 提供 lazy metadata `list`、有限预算真实 `search/read`、snapshot 验证和显式失效。选择只是授权，metadata/preview 不作为全文证据。
- 本地嵌套 12 文件、同名文件、分页、读取尾部 offset、并发限制、取消、同长度内容变化、删除、移动和权限撤销均有定向测试。
- 实际 document capture 可以读取 10+ 文件/目录；超过默认 100 个可读文件明确拒绝全量 capture，提示改用索引分页检索。byte budget 默认 32 MB，硬上限 128 MB；并发最多 4。
- Notebook 读取不再停在旧发现 preview 的前 20 cell，实际 source 测试覆盖后续 cell。Markdown/文本/代码与现有文档提取路径复用共享抽取能力；unsupported binary 不生成文字证据。
- Cloud 多选以 opaque `libraryId/itemId` 为身份；12 个嵌套同名云文件的 source id、真实内容与权限 snapshot 保持分离，不使用伪文件系统路径。
- Cloud 引用带 `EvidenceRef.cloudIdentity`（全部 `LibraryRole`）、provider scope、真实 revision 与页/行/cell 定位。`citation-contract` 输出 `/library?library=…&item=…#…`，不构造 filesystem navigationTarget；移除 provider、scope/身份/role/revision 改变后旧快照不能继续冒充有效来源。

## PDF 提案与审查边界

- `LATTICE_SOURCE_PDF_TOOLS` / `LATTICE_SOURCE_PDF_SKILL` 是 API function schema 与本地 dynamic tool bridge 共用的真实执行声明；本地工具能够 list/search/read/propose。
- `lattice.pdf.proposeChild` 先校验 index 的 root/workspace scope，再实际读取已授权父 PDF，绑定读取 snapshot；未选 PDF、另一 root、另一 workspace、准备期间父版本变化均拒绝进入 `onProposal`。
- `lattice.cloud.pdf.proposeChild` 绑定当前 provider、父 identity/version/role；prepare 过程中 scope、当前父资源或取消变化均拒绝进入 review callback。
- 工具没有 apply/approve 操作。生成提案不创建 `.lattice`、manifest 或子文件；prepare 仅读取已存在 manifest，实际初始化由用户审查应用后触发。
- 本地提案复用 `pdf-item` 的 manifest、稳定 item identity 与真实 itemFolderPath。用户具体审批匹配 proposal id/version/workspace/target，应用经 write guard、父版本和 expectedContent 核验、writable close/abort、写后回读与刷新。
- `.md/.ipynb/.csv/.tsv/.json/.txt` 子文件受文件名、JSON/Notebook 结构和内容预算限制，支持 create/update；同名 PDF 的 stable id 不可混用。
- 测试覆盖真实 manifest 下提案无写、用户审查应用、父 PDF 改名后通过 manifest 仍落在同一子文件目录、stale parent/child、提案修改和已有数据子文件冲突。
- 云创建仅通过 `provider.createChild(... expectedParentVersion)`；云更新仅通过 `provider.save(... expectedVersionId)`。应用再次验证 parent、子项关系和权限。云 display/review URL 从不传入本地写入函数。
- Workbench 云审查 fixture 渲染具体全文与父版本，点击“审查并应用”后才调用云 provider，结果保持为真实云 child。已有本地 Workbench 分支复用 reviewed PDF apply 并刷新/打开 PDF virtual child。
- `prepareWorkspaceFileTask` 对非空 PDF 子文件要求调用方传入已读取、已核验的 `sourceContext`（完整文本与 `EvidenceRef[]`）；上下文作为 untrusted source data 原样进入生成 prompt，draft 保留真实引用。没有 context 时在模型调用前拒绝；空白子文件继续走无模型路径。

## 验证命令与结果

最终定向测试：2026-10-08 22:04:35 本地时间开始，Vitest 实际运行版本 4.1.8，17 个测试文件、130 个测试通过，耗时 29.52 秒。涵盖下列 suites：

```powershell
node "node_modules/vitest/vitest.mjs" run `
  "src/lib/ai/__tests__/source-index.test.ts" `
  "src/lib/ai/__tests__/source-pdf-tool-runtime.test.ts" `
  "src/lib/ai/__tests__/document-source.test.ts" `
  "src/lib/ai/__tests__/document-source-capture.test.ts" `
  "src/lib/ai/__tests__/document-source-desktop-recovery.test.ts" `
  "src/lib/ai/__tests__/document-source-folder.test.ts" `
  "src/lib/ai/__tests__/conversation-documents.test.ts" `
  "src/lib/ai/__tests__/cloud-source.test.ts" `
  "src/lib/ai/__tests__/cloud-source-selection.test.ts" `
  "src/lib/ai/__tests__/cloud-pdf-child-skill.test.ts" `
  "src/lib/ai/__tests__/pdf-child-skill.test.ts" `
  "src/lib/ai/__tests__/workspace-file-task.test.ts" `
  "src/lib/ai/__tests__/citation-validation.test.ts" `
  "src/lib/ai/__tests__/citation-markdown.test.ts" `
  "src/lib/ai/__tests__/citation-history.test.ts" `
  "src/lib/ai/__tests__/chat-source-validation.test.ts" `
  "src/components/ai/__tests__/workbench-cloud-review.test.tsx" --maxWorkers=1
```

归属生产源码 ESLint：0 errors；`workbench-queue.tsx` 原有 highlightedProposal effect 的 `react-hooks/set-state-in-effect` warning 不属于本次 PDF/cloud 修改。测试目录由仓库 ESLint ignore 排除，测试执行结果以上述 Vitest 为准。

直接 TypeScript 检查命令为 `node "node_modules/typescript/bin/tsc" --noEmit --incremental false --pretty false`。首次全局检查报告共享 `src/hooks/__tests__/use-shared-annotation-system.test.tsx` 第 15、39、48 行的 mock tuple/Promise 类型错误，归属 source/PDF 文件无错误；已交父窗口处理，未修改共享 hook。

## 源码清单与集成接口

延续/收尾的生产模块：

- `src/lib/ai/source-index.ts`、`document-source-capture.ts`、`document-source.ts`、`conversation-documents.ts`、`workspace-indexer.ts`
- `src/lib/ai/cloud-source.ts`、`types.ts`、`citation-contract.ts`
- `src/lib/ai/lattice-skills/source-pdf-tool-runtime.ts`、`pdf-child-skill.ts`、`cloud-pdf-child-skill.ts`
- `src/lib/ai/workspace-file-task.ts`、`workbench-actions.ts`
- `src/components/ai/workbench-queue.tsx` 的 PDF/cloud review 分支及对应 tests
- 本报告所列 source/PDF/citation/workspace suites 与 `src/lib/ai/__tests__/fixtures/source-workspace.ts`

给父窗口的兼容接口：

1. `parseSourceSelections(query)` 与 `parseCloudSourceSelections(query)` 均不会因坏 URI 编码抛错；另有同参数 `invalidSourceSelectionMentions` / `invalidCloudSourceSelectionMentions` 返回需提示的原 token。解析不会更改用户正文。
2. `buildCloudSourceSelectionMention` / `captureSelectedCloudAgentDocumentSources` 支持 cloud file/folder 多选。capture 可传 `signal/maxFiles/maxTotalBytes/maxFolders/maxEntries/concurrency/isCurrent`；预算溢出明确拒绝当前全量 capture。
3. `AuthorizedSourceIndex.assertScope(rootHandle, workspaceKey)` 由 runtime 内部使用；既有 `createAuthorizedSourceIndex` 调用保持兼容。新增 `maxDirectories/maxDiscoveryEntries` 可选参数限制空目录发现。
4. `resolveAuthorizedDocumentLocation(root, path)` 返回实际 `{ handle, path }`，供授权检查使用；原 `resolveAuthorizedDocumentHandle` API 保持不变。
5. `preparePdfChildProposal` 可选 `sourceSnapshot` 将提案绑定实际读取版本；`prepareCloudPdfChildProposal` 可选 `isCurrent` 用于异步过程中验证 host。

云主窗口现已提供所需只读 host：`getCloudWorkspaceSnapshot` / `subscribeCloudWorkspaceHost`，snapshot 含 `{ active, provider, resource }`，退出/账号切换必须撤销 provider。provider 所需契约为 `scope/list/read/search/save(expectedVersionId)/createChild(expectedParentVersion)`；Workbench 打开结果通过既有 `setCloudWorkspaceResource`。

## 验收边界与交接

- 真实收费推理请求：0。真实已登录 harness 推理：0。读取凭据/auth 配置：0。远程上传用户文件：0。
- 本报告的 filesystem/provider/PDF extraction 对抗测试使用隔离 fixture；Workbench 使用真实 React 组件和 store/provider fixture。真实浏览器整链、native harness、主窗口安装和 full `qa:gate` 由父窗口统筹，本报告不冒充其证据。
- 本地 writable 采用文件 API 的暂存/close 提交和 abort；不声称提供跨进程 OS 事务或目录级原子性。外部编辑在检查与最终底层提交之间的极短竞争仍受底层文件 API 限制，创建失败也可能留下空文件入口。
- Cloud 的最终授权、同名约束与 expected revision 的原子性属于真实服务端边界；source 侧每个关键异步边界重验、停止新读取并关闭已提取 source。provider adapter 若不透传某项 `AbortSignal`，已发网络调用可能继续，但其结果不会恢复已取消 source 的有效状态。
- 未修改 shared-library、pdf-item、searchable-text、host、main、依赖/lock、版本或发行；未执行 Git、部署、安装。交接完成后 source 归属源码只读等待父窗口审查。
