# 云端文件夹、对话上下文与本机执行验收

## 真实问题与修复

1. 云库原为独立 shell。现移除独立 cloud tree/tabs/split，采用同一 ExplorerSidebar、共享树行与菜单、新建栏、MainArea、PaneWrapper、TabBar、LayoutRenderer 和文件查看器。cloud-file 显式来源身份保留账号、库、条目与版本，不伪造本地句柄。
2. 云端文件可与本地文件放入同一标签布局，使用同一分栏、编辑保存和重开恢复。修复跨 realm 二进制上传、文件扩展名路由和草稿丢失；未知格式保留原字节下载。云管理移入对话框，浏览时只保留侧栏来源与必要操作。
3. 对话来源列表被新活动标签覆盖，准备正文时又优先读取新活动文件。现在持续保留本会话同工作区来源目录，按本轮引用选择正文；自然文件名支持定位未打开的文件，同名歧义要求完整路径。最近谈论的材料与完整来源目录分开。
4. 单独授权的多个文件标签可用于核验旧来源，不再仅核验活动标签。源版本/账号/权限变化仍阻止把过期材料作为已核验来源。
5. 本机请求现在带有有界、已核验的对话记录和相关文件摘录，两种本机助手均注册 Lattice 文件读取/搜索和 PDF 子文件提案工具。
6. Codex 在 Windows 上发现/连接成功，但 thread/start 因自动 AGENTS.md 沙箱访问失败。修复自动项目文档读取兼容性，保持 root deny，禁用直接 shell/patch，改用范围受限的 Lattice 文件工具。
7. Claude 原生桥此前每轮启动无工具进程并等待 EOF；现使用持久 SDK 初始化、Lattice MCP 控制消息、result 终态及可恢复模型/工具定义，保留原服务具体错误。
8. 本地文件/PDF/文件夹右键上传可选择库和目标目录。PDF 批注、公式/几何定位信息及层级子文件一起迁移，新云版本绑定；兼容精确路径的旧版批注，已知身份/版本矛盾显示警告。原作者来源和当前上传者身份分别保存。
9. 新增成员昵称协议与数据库权限约束；PDF 批注显示当前成员昵称或已验证的创建时昵称。PDF 子文件面板同样接入云来源，能够显示并创建云端子文件。
10. 云 Markdown 阅读/实时编辑、HTML 支持同库相对图片与样式资源，各标签来源独立，Blob URL 生命周期清理。修复权限撤销后旧编辑器不禁用、保存途中新编辑误标已保存、首屏恢复吞草稿及正常取消读取误报断网。
11. 本地与云标签共存后的跨来源指代：请求在开始时绑定存储类型、工作区和账号，解析、历史验证、读取及 PDF 子文件草稿始终沿用此绑定。明确“当前文件”或指定另一文件可切换目标；账号/工作区变化不能静默回退到新的文件。

## 已验证

- 对话/上下文/状态相关整合：5 文件 144 测试通过；补充 helper/runtime 状态测试通过。
- 云浏览聚焦：5 文件 56 测试通过；TypeScript、聚焦 ESLint 通过。
- 真实主入口云浏览：1440×1000 与 900×800，8 次真实 HTTP blob 下载；Markdown、代码、HTML、DOCX、图片、Notebook、PDF 实际渲染，目录展开折叠、未知文件下载一致、标签与断点草稿保持；错误 0。
- 共用布局浏览器验证：云文档 Ctrl+S 保存与 reload 恢复、同一工作区分栏、Markdown/HTML 相对图片真实加载通过。
- PDF 包与昵称：合成的本地 PDF/批注/子文件经实际上传 helper → 本地 HTTP/Postgres RLS；云 PDF 高亮和评论、上传者昵称与嵌套研究笔记渲染通过。昵称通过 UI 保存后实际后端成员记录更新。
- 真实右键上传交互通过：新建 OPFS 测试目录 → 本地 Explorer 右键选择文件 → 目标库/目录确认 → HTTP/数据库 → 云端原查看器打开。确认前无上传，未选中的兄弟文件无上传。
- 独立审查补充：权限降级/撤销通过真实 store/controller 通知链测试；异步保存与重复保存、分阶段恢复和工作区切换的草稿保护均通过。跨本地/云对话来源 143 项相关测试通过。
- 实际浏览器对话：第一次读取 A 标识 ALPHA_SOURCE_731；打开 B 后问“它”仍只读取 A，历史条数增加；明确问 B 后读取 B 标识 BETA_SOURCE_482。测试 provider 为明确 fixture，模型费用 0。
- 整合复查补充 54 项来源 helper/核验测试通过：普通 API 成员名和 URL 不强制文件定位、比较嵌套云文件包含双方、独立授权外部文件在已有工作区时仍可重新验证。
- 原生确定性测试：33 passed / 7 ignored；真实 Codex 和 Claude 初始化/会话启动的两项 zero-inference 测试通过。

## 用户授权的真实请求

本轮上限为 Codex 2 次、Claude 2 次，全部只用新建的测试文本和文件。唯一执行者记录在 `.lattice-build/harness-live-budget-20261012.json`，剩余额度为 0。

| 工具 | 请求 | 结果 |
|---|---|---|
| Codex | 1 | 实际 Lattice read 工具返回新文件标识，流式回答和 completed 均收到 |
| Codex | 2 | 同一 thread 记住首轮标识，没有再读文件，完成 |
| Claude | 1 | 原工具默认映射到 deepseek-v4-pro[1m]，服务拒绝模型/权限，未回答 |
| Claude | 2 | 显式 sonnet 被原配置映射到 deepseek-v4-pro，服务仍拒绝，未回答 |

Claude 的服务配置仍未通过真实回答验收。`~/.claude/settings.json` 中模型别名将 sonnet/opus 指向 DeepSeek；未读取或导出密钥、未更改用户原配置。产品现在显示实际服务拒绝模型的错误，并提示选择可用模型或检查原工具映射。模型列表/认证/初始化成功不等于服务接受推理。

云服务测试使用真实本地 HTTP/Postgres RLS，Auth/R2 为隔离 fixture，未部署生产云服务。PPTX 使用本地相同生产路由的单测验证，本轮浏览器未渲染实际 PPTX。昵称跨成员同步需要部署随代码提供的新数据库迁移和 Worker；本窗口只更新本地桌面，不自动操作生产数据库。

## 发布

最终 `npm run qa:gate` exit 0：lint 无错误（199 项既有及非阻塞警告）、typecheck、159 份文档检查、483 测试文件 / 4017 项测试、前端生产构建、Tauri release 与 MSI/NSIS 安装包全部通过。原生编译保留两项既有未使用函数警告。证据 `.lattice-build/qa-unified-cloud-final-20261012.log`。

发布目录：`releases/v3.1.0-cloud-context-20261012`。使用 canonical prepare-release 打包已通过门禁的产物，并生成 manifest/checksums。

本机已安装并重新打开 `C:/Users/XINGLUOYUNSHEN/AppData/Local/Lattice/lattice.exe`，大小 19,703,808 bytes，SHA-256 `e305a1a98ea5bf90a2de7db156cbcf44013a93e1fd51121355e9b619aa0dd622`，与发布产物一致。旧版窗口通过正常关闭退出，未强制结束用户窗口。安装器初次等待超过脚本 60 秒期限，随后完成；最终确认安装器已退出及程序 hash 匹配，不把超时脚本称为 exit 0 安装。

安装后实际桌面验收 exit 0：在隔离 diagnostics profile 中，两种本机 CLI 的 initialize/session-start 均成功；云 Markdown/PDF 的两次真实 HTTP blob 下载和实际渲染通过；打开 B 后追问仍携带 A 的 `ALPHA_SOURCE_731` 标识，历史从 0 到 1；page errors 为 0；外部模型推理请求为 0。报告 `.lattice-build/native-installed-report-20261012.json`，截图 `.lattice-build/native-installed-cloud-pdf-20261012.png` 与 `.lattice-build/native-installed-context-20261012.png`。第一轮预安装测试的诊断页退出收尾超时，修正脚本返回主工作区再正常关闭后，安装后完整流程 exit 0。

本轮仅更新本机桌面产品，没有执行生产云迁移、远端部署、Git 提交或推送。跨成员昵称功能部署要求见上文。
