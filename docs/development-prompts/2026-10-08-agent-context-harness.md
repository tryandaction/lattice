# Lattice AI Agent 与本地 Harness：独立窗口开发委托

## 用户授权与 Goal

用户明确要求两个新正式窗口自主专业设计、开发及迭代，主窗口最终更新本机 **3.1.0**；你负责AI窗口。先调用 create_goal：完成可持久会话与文档上下文、长输入、跨文件/文件夹索引阅读回答、Markdown复制、PDF子文件工作技能、可见执行事件，以及直接连接用户已安装Codex/Claude Code和可验证其他harness的能力，经过失败与恢复、原生协议和真实UI验收后交接主窗口。只在本窗口全部实现及交接完成时Goal complete；不自行安装产品。

用户已授权专业设计实现和隔离测试，无需根据技能通用设计审批重复停工；先写设计/计划再逐项落实。复现症状才能确定根因，不能因为已有persist字段或copy函数就说用户问题不存在。不是新增一排不工作选择器，保持简洁的科研/学习/办公助手。

## 当前事实与入口

src/stores/ai-chat-store.ts 已存conversations、documentContext、flushConversations，但loadConversations默认设activeConversationId为conversations[0]；src/components/ai/chat-composer.tsx承担发送和任务路由；chat-timeline.tsx复制源content但错误吞掉。document-source-capture.ts只识别PDF/MD显式文件mentions，conversation-documents.ts路径上限8，workspace-indexer.ts有短preview与Notebook前20cell逻辑；这些可能只是展示摘要，不能先把所有slice删掉或无限全文装入请求。

重点阅读 src/components/ai/{ai-chat-panel,chat-composer,chat-timeline,ai-chat-context,chat-conversation-metadata}.tsx/ts，src/hooks/use-ai*，src/lib/ai/**、src/stores/{ai-chat,ai-workbench,agent-session,agent-memory,ai-provider-profile,ai-pdf-companion}-store.ts，src/lib/searchable-text.ts，src/lib/pdf-item.ts与shared-library/item-workspace及现有workspace-write-guard。阅读3.1.0交付报告，保留以前超时/429/结构校验/源证据和文件审查修复。

本机仅检测到codex.exe（PATH），位于 C:/Users/XINGLUOYUNSHEN/AppData/Local/OpenAI/Codex/bin/9691020b546a15b2/codex.exe；版本与协议仍须使用实际 --version/--help/生成schema核对，不硬编码路径作为唯一入口。PATH未发现claude/deepseek/opencode，不代表用户没有安装；支持手选路径/状态探测。用户的“DeepSeek harness”具体发行物尚未确认，不把DeepSeek模型/API或shell命令框冒充现成agent harness。

## 必须落实的六条主链路

1. **关闭与重开不丢上下文**：区分隐藏AI面板、关闭文件tab、切workspace、重载Web、退出/崩溃重启桌面。持久active conversation ID、composer draft、conversation workspace/library身份、源file/version与完成历史/阅读checkpoint；hydrate single-flight、存储schema迁移、FIFO/失败恢复/flush。恢复原对话并能在真实模型请求里沿用有效history/source，不只是UI显示旧bubble。新对话不继承不相关文件，workspace/账号权限变化需重新验证，失败/停止/未验证草稿保持可见但不能混入已验证model history。文件被删除/修改/权限撤销，报告源失效并可重选，不能继续伪称“本文已读”。
2. **长输入完整保存与可处理**：调查textarea/IME/粘贴/mentions/draft/router/context builder/transport/provider限制；用户正文不能被UI固定字符数截掉或把preview当prompt。输入数万字可滚动编辑、完整存储和提交；有真实上下文上限时明确预计token/可处理范围，转为分批/引用文件/压缩已验证历史，不无限加maxTokens。长输出checkpoint、续写、取消恢复保持一致。给出50K中文/英文混合、多段LaTeX与粘贴/IME回归，不触发真实收费推理。
3. **跨文件/目录索引阅读与回答**：用户可选择文件/文件夹/@提及、授权当前workspace或云库，按需列出索引→搜索→读取相关chunk/完整需要的文档→跨文件综合→验证引用。支持嵌套路径、同名文件、超过8个文件、PDF/Markdown/文本代码/Notebook及现有可抽取格式；unsupported binary不编造内容。复用searchable-text、workspace-indexer、context graph，增量index/file revision、删除/移动处理、读取预算、并发/取消、对大目录懒加载。检索到summary不等于全文已读；回答标明真正使用范围，页/section定位可点击且稳定。前端可见选择源列表是授权和控制，不添复杂模式菜单。云库接口由另一窗口提供，提出契约建议交主窗口整合，不修改云库归属。
4. **回答复制Markdown**：源Markdown含标题、列表、表格、公式/代码fence可一键完整复制，按钮在触屏/键盘也可达、streaming/partial可说明状态，失败显示可恢复错误而不是静默。普通文本/选择复制只在确实有需要时提供，不能复制DOM拼字丢结构。已验证引用复制为可持久Lattice源链接或明确说明内部引用，不能把citation:临时ID或Unresolved伪链接传播到导出笔记。JSON思考块/内部trace不混进回答Markdown。真实clipboard API与浏览器session读回验证。
5. **PDF子文件技能**：将Lattice工具/skills可发现且可执行：读取PDF→结构化讲解→创建/更新父PDF下.md/.ipynb/数据子文件→用户审查→原子写入/刷新树→打开结果。复用pdf-item manifest/stable identity/location及workspace-file-task/write-guard，不能凭字符串拼一个不存在的atom目录。移动/改名后仍挂在同一PDF下；同名PDF不混淆；有expected revision/stale conflict；云PDF由服务权限和version保护。技能可在API agent和本地harness消费（文档/机器工具声明），不要只把“你可以创建PDF子文件”写进system prompt。
6. **可见、真实的执行过程**：现有Agent trace/progress事件可见且持久：准备上下文、正在读哪些源、计划、tool开始/完成、文件改动提案、检查、等待审查、失败重试/暂停。折叠时间线/当前步骤即可，回答主体不放一堆内部日志。只显示来自实际执行的事件和可公开推理摘要；模型没提供摘要时准确说明，不伪造完整隐藏思维链。取消后不继续显示running，不让迟到event复活任务；不同conversation events不串流。事件含source/tool ID与时间但不泄漏tokens、密钥、个人配置。

## 用户已安装 Harness 的直接接入

设计统一 Runtime/Transport contract，但只实现有官方/本机协议证据的adapter，不预填一堆无用engine。产品可选API研究助手、本机Codex、本机Claude Code，已安装探测/手选路径/连接状态、版本、登录需用户在原产品完成，支持会话start/resume/turn/stream/interrupt/error/approval/session mapping。复用已有provider配置信息，不给用户重复配置同一个AI三次。

**Codex**：先查当前官方 https://learn.chatgpt.com/docs/app-server （旧 https://developers.openai.com/codex/app-server/ 会重定向），按本机版本生成/检验schema。优先Rust拥有本地child的stdio JSONL App Server，initialize/initialized、thread/start/resume、turn/start/interrupt、真实item/agentMessage/tool/fileChange/approval events。官方WebSocket实验限制不能变成暴露公网无认证listener；不依赖私有Codex app数据库，不猜应用内部HTTP接口，不复制登录tokens。已安装harness自行管理用户登录，Lattice不读/导出/.codex/auth凭据；可提供原CLI登录指引，不自行登录或重置原应用。

**Claude Code**：官方 https://code.claude.com/docs/en/headless 、https://code.claude.com/docs/en/cli-reference 和官方SDK文档。支持有证据的 -p/stream-json/verbose/include-partial-messages/session resume，区分stream text delta、tool events和result+exit status。缺可执行/版本不支持需解释并允许重选；若权限回调仅SDK支持，选真实SDK/stdio可审核实现，不靠假approvalUI。用户仍由本机Claude管理登录，不收集其登录凭据。

**其他/DeepSeek**：确认具体产品协议与可执行后实现；DeepSeek-compatible provider可沿当前API，但不冒充local harness。可验证的ACP/JSONL兼容adapter保留声明和能力探测；未知格式保持unsupported明示且不启用执行。没有协议证据不要做任意shell命令模板执行器。

必须通过Tauri原生拥有/管理子进程，在Windows隐藏窗口、argv/stdin严格传递、UTF-8/长文本/空格路径/分片NDJSON/背压/有限stderr/超时/异常退出/停止进程树/重连和多个conversations隔离有测试。不允许 --dangerously-skip-permissions/--yolo、全盘未约束写权限、泄漏凭据到argv或报告。外部agent默认限定到用户明确workspace；原生writes若不能与Lattice review broker衔接，应在隔离scratch准备artifact后正式审查应用，不能宣称“所有改动受审查”但实际CLI直接落盘。审批只能针对具体tool/action/diff/resolved path，审批回复ID匹配，不能借另一请求授权。

开发允许实际CLI --version/--help/schema及本地不推理协议握手探测；**不允许调用用户已登录harness推理/付费AI请求、上传用户文件、读取credential/auth配置或扫描全盘**。用可执行fixture进程还原真实官方协议进行原生bridge tests，清楚区分fixture与真实安装握手；主窗口仅在后续具体获授权后测真实推理。不要因没Claude安装而把真实Codex adapter降为mock占位。

## 归属与共享接入

你拥有 src/components/ai/**、src/lib/ai/**、src/hooks/use-ai*.ts、上述AI/Agent stores及各自tests；可新增 src-tauri/src/agent_harness.rs 与src/lib/ai/harness/**，新diagnostic组件 src/components/diagnostics/agent-context-harness-diagnostics.tsx。src/lib/searchable-text.ts 若需改先给主窗口建议，cloud也会用它。

主窗口独占src/components/layout/**、settings-dialog、全局i18n/settings schema与store、workspace-store/layout类型、storage-adapter、app/layout和globals.css、renderers及pdf-item/pdf-*、src-tauri/src/main.rs、依赖lock/版本/发行。Native模块与commands先在自己的文件实现，main.rs注册/State/window-close cleanup和sharedsettings接入写精确请求到 docs/tests/2026-10-08-agent-context-harness-handoff.md。新AI专属Runtime配置可用自己versioned storage以减少共享settings冲突。cloud窗口拥有shared-library/**/其stores/Library routes/Worker/Supabase，不改其文件。跨cloud读/写bridge写interface与流程交主窗口协调。

用户禁止git commit/push/reset/checkout/分支/worktree；共享大量现存未提交成果须保留。不更新核心依赖/全局工具，不修改版本3.1.0，不打包安装或远程部署、不杀其他进程。独立dev port3539 / NEXT_DIST_DIR=.lattice-build/agent-context-dev-20261008；只停止自己PID树。先读本地Next指南、使用项目flow和系统调试/验证原则；初次上下文读取有限而够用，不反复读全目录。

## 验收与交接

必须覆盖真实UI链：选择第二历史对话→关面板/切文件/新进程恢复→跟进时请求历史和source版本正确；新对话无串文；50K输入完整到fixture；选择嵌套目录10+文件检索阅读→跨文件回答→可点击真实引用；删除/修改/权限撤销index失效；复制Markdown与代码/公式/table/source links真实读回；PDF分析→子Markdown proposal→审查apply→树可达→改名/reopen后仍是子文件；执行事件先后/取消/迟到与resume。外部harness模拟stderr/半包JSON/unknown事件/empty/EOF/truncation/approve/decline/interrupt/crash-resume/超限及跨thread隔离，原生exit后无孤儿进程；真实已安装Codex版本/不推理握手验证。

先针对性新增失败回归再修；focused tests、归属lint、typecheck、docs、真实browser/nativefixture，不只靠mock fetch。所有真实请求数/fixtures/没有测的部分明确记录。主窗口独占最终full qa:gate+Tauri构建+installedhash核验。

交接必须有症状→已确认根因→最终行为→测试证据路径、代码清单/接口和Nativemain注册要求、运行协议版本、workspace/permission隔离、用户如何直接用本机harness、真实CLI与fixture边界、未确认DeepSeek发行物及必要依赖。实现完成后源码只读等待主窗口审查，收到意见继续既有Goal，不另建窗口。
