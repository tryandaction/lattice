# AI 会话持久化与长输入处理证据（2026-10-08）

## 已确认症状与根因

首次新增的 5 项回归在旧实现上失败：选择第二历史会话后恢复成首行、50K 草稿没有保存、异步加载覆盖新会话、AppLayout／AI 面板重复读取、加载期间清空后旧历史复活。旧 schema v2 只有 `conversations`，`activeConversationId` 与普通输入草稿没有进入快照；`loadConversations` 每次覆盖并选首行，`composerDraft` 只是一条被 consume 清除的瞬时命令。

后续失败回归确认了额外边界：Web pagehide 前没有同步保存，源授权附在 user 消息时留下孤立 assistant 历史，未来 schema 被低版本写入覆盖，错误后的迟到 completion 替换保留草稿，source metadata 替换后沿用旧验证，以及首次用户输入早于 AppLayout 加载时覆写磁盘历史。各项均先复现失败再修复。

## 最终行为

- schema v3 保存 active ID、完整 conversation draft、workspace／library／account／permission 身份与 composer mode。兼容旧数组和 0／2 envelope；旧空历史过滤，v3 空会话保留。未知未来版本与严格读取失败会阻止覆盖，保留本次内存草稿并允许读取重试。
- 普通草稿完整保存，无固定字符截断。外部 `setComposerDraft`／`consumeComposerDraft` 保留单次命令行为；consume 不删除普通草稿。恢复不会自动 submit。新建／切换／删除当前会话清除瞬时命令，普通 draft 归属于自己的 conversation。
- 双入口 hydration 为 single-flight；已完成加载不重复读磁盘。加载期间本地会话优先，磁盘历史合并；delete／clear 不复活旧历史。首次本地编辑自动启动加载，避免启动 effect 尚未运行时覆写已有数据。
- FIFO 保存保留 strict flush 边界，加载中 flush 仍保存调用时的本地快照并补齐磁盘历史；后续编辑由后续写入保存。background 也优先用 `setStrict`，错误进入 `persistenceError`，严格 flush 原样 reject，失败后队列仍可重试。
- 连续输入和输出最多每两秒提交检查点，实际写入延迟由 adapter／IPC 决定。Web hidden／pagehide／beforeunload 有同步 localStorage 快照和严格 flush；同步检查点后旧排队 Web 快照不能覆写较新数据。Desktop 不绕过权威存储，原生正常退出仍须等待 strict flush；OS 强杀不能保证最后尚未落盘的字节。
- 恢复中的 streaming 回答成为可见 interrupted 草稿，不修改仍在运行的原对象。停止、错误、partial、unverified 和未重新验证源的 turn 排除出 API 历史，UI 原内容保留。错误／停止后的迟到输出不会替换原草稿。
- source 验证结果按 message ID 记录，仅在本次运行有效；hydrate 不恢复它们。身份变化清空验证集；替换某条 source metadata 只撤销该条，已验证的其他源 turn 仍可用。源文件 revision／权限的实际检查由调用方逐源执行，不能将 `mark` 本身当作文件已复验的证据。

## 对外接口

```ts
setConversationDraft(draft: string | AiChatComposerDraft | null, conversationId?: string): string
getConversationDraft(conversationId?: string): AiChatComposerDraft | null
setConversationWorkspace(binding: ChatConversationWorkspace, conversationId?: string): void
markConversationSourcesValidated(binding, conversationId?, messageIds?: string[]): boolean
invalidateConversationSources(conversationId?: string): void
getMessagesForApi(conversationId?: string): AiMessage[]
getLongInputResume(assistantMessageId?, conversationId?): {
  input: string;
  checkpoint: LongInputCheckpoint;
  assistantMessageId: string;
  conversationId: string;
} | null
flushConversations(): Promise<void>
```

Composer 输入变化和提交后的清空应带明确 conversation ID，发送前异步验证也按固定 ID 读取 API 历史。`mark(..., ids)` 只允许实际逐源验证通过的消息；无 ids 保留兼容的全量标记语义。调用者应确认验证快照仍是该消息的最新 source metadata。老消息缺 revision 快照时不要标为验证通过。`persistenceError`／`hydrationError` 用于可恢复 UI 提示；测试模拟新进程时设置 `hasHydratedConversations: false`。

主窗口原生 close handler 需在退出前等待 `useAiChatStore.getState().flushConversations()`，失败应阻止虚假“已保存”反馈。未修改共享 layout、storage adapter、Tauri main 或其他 store。

## 已知超限的长输入

`estimateLongInputBudget` 使用正式 model contextWindow、输出保留、已验证 history／system 开销及估算余量。未知 contextWindow 不猜一个上限、不自动分批；普通原文仍由原 route 完整提交。分批只在已知超限且 UI 明确选择后调用 `processLongInput`。

`processLongInput` 接收 `AiProvider.generate` 依赖注入。原文以 SHA-256／长度和任务 hash 绑定 checkpoint，顺序提交完整 UTF-16 范围，边界不拆 surrogate pair；保存实际模型返回摘要和 completed ranges。模型返回 length／refusal／tool_calls／空内容或摘要超过估算保留量时不标完成。摘要超出综合预算时按序分组调用模型压缩，保存 compression checkpoint，最终回答明确分批提交范围和摘要可能省略细节。没有截掉原正文，也没有构造“已读”或思考内容。

取消、批次失败和最终综合失败均抛出携带 checkpoint 的 `LongInputProcessingError`。provider 忽略 AbortSignal 时 abort race 也能立即结束，迟到成功／失败只被观察，不推进 completed ranges。相同原文／任务／model／budget 可以续跑并跳过已完成片段；改原文或任务拒绝旧 checkpoint。`getLongInputResume` 从真实相邻 user 消息取原文，不创建虚构文件。检查点通过 `AgentResultMetadata.inputCheckpoint` 保存；`onCheckpoint` 可 await metadata 更新和 strict flush。

原文 hash 使用 UTF-16LE code units 的 SHA-256，保留未配对 surrogate 的区别，避免 UTF-8 TextEncoder 替换字符造成错误复用。损坏的 checkpoint 会被 schema 守卫拒绝；保存中的 processing checkpoint 在崩溃恢复快照中标为 interrupted，仍在运行的原对象不变。

token 值是估计和配置边界，不宣称等同远端 tokenizer 的精确计数；实际 provider 超限仍走可恢复失败路径。当前需要 runtime 提供 SubtleCrypto SHA-256；缺失时明确失败，不使用弱 hash 假冒 SHA-256。

## 测试与边界

Focused 命令：

```powershell
npx vitest run "src/stores/__tests__/ai-chat-store.test.ts" "src/lib/ai/__tests__/long-input.test.ts" --maxWorkers=1
npx eslint "src/stores/ai-chat-store.ts" "src/lib/ai/chat-session-persistence.ts" "src/lib/ai/long-input.ts"
npx tsc --noEmit --pretty false
```

store 测试使用隔离 adapter fixture；Web pagehide 同步路径真实读回 jsdom localStorage。长输入测试使用 Node 中可执行 provider fixture，主动拒绝超过请求预算的 payload，并核对 50K 中文／英文／公式／emoji 正文的逐批拼接与连续范围。没有真实模型、API 网络请求或登录 harness 推理，真实收费请求数为 0。

2026-10-08 15:08 的 focused 结果为 **66／66**（58 store、8 long-input），两文件全部通过；归属 production ESLint exit code 0。全量 typecheck 在并行整合时仍发现其他归属的暂态接口错误，已向主代理同步，不将其描述为全量通过。

最后一次全量 typecheck（15:09）exit code 1，报错属于并行整合：`harness-execution-timeline.tsx` label 表缺 `tool-call`；cloud source selection 测试等待新 selection 导出；shared-library `cloud-pdf.ts` 等待 controller `assertCurrentVersion`。本子任务源码未在该输出中报错。父代理负责这些归属的最终整合与重跑。

真实浏览器双入口／IME／关闭面板、native 正常退出／重启等整合验收由主代理执行，本片段不把 jsdom 或 fixture 描述为真实 UI／native 重启。最终 full qa:gate、Tauri 构建与安装 hash 核验由主窗口负责。

本子任务源码：

- `src/stores/ai-chat-store.ts`
- `src/stores/__tests__/ai-chat-store.test.ts`
- `src/lib/ai/chat-session-persistence.ts`
- `src/lib/ai/long-input.ts`
- `src/lib/ai/__tests__/long-input.test.ts`
- 本证据文档

没有执行 Git、分支、安装、部署、真实推理或共享归属修改。
