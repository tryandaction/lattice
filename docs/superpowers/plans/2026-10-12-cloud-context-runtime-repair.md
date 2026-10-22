# 云端文件夹、对话来源与本机助手执行修复

用户验收目标：云库能像本地文件夹展开、打开及浏览；Codex/Claude 完成真实任务；同对话切换标签后继续理解前文，按文件名定位未打开材料。

- [x] 云库基础读取：修复跨 realm 二进制上传和文件名类型路由。
- [x] 云库浏览架构：移除独立 cloud tree/tabs/split shell，复用 ExplorerSidebar/TreeView 行与交互、MainArea/PaneWrapper/TabBar/布局状态；显式 cloud-file 来源不伪造文件句柄。
- [x] 上传协作：本地右键上传，PDF 自动收集批注与子文件、旧版绑定兼容；小组成员昵称持久化与批注标签，真实 HTTP/RLS 验证。
- [x] 云源完整交互：PDF 子文件面板共用、Markdown/HTML 相对图片、权限变更与草稿保存/恢复边界回归。
- [x] 跨本地/云对话：请求绑定语境来源，读取、历史校验、子文件草稿与本机来源检查保持一致；显式当前/文件名覆盖、账号失效与新话题回归通过。
- [x] 对话来源：持续维护同工作区来源目录；本轮按显式引用、自然文件名、当前文件指示或前文选择材料，内容与身份必须匹配；保留非活动但仍授权的标签。
- [x] 本机助手协议：覆盖 connect → session → turn → tools → completion 和 resume；解析协议错误，修复 Windows 启动与 Claude 文件工具，不扩大默认文件权限。Claude 实际推理仍受用户上游模型不可用限制，不宣称通过。
- [x] 真实请求：本轮 Codex 2/2 成功、Claude 2/2 模型不可用。预算全部使用，禁止追加请求；记录到 `.lattice-build/harness-live-budget-20261012.json`。
- [x] 验收发布：聚焦测试、真实浏览器/原生验收、完整 qa:gate（483 文件 / 4017 测试）、本机桌面 3.1.0 安装 hash 校验及安装后实际验收通过；不部署远端，不提交 Git。

已复现证据：conversationDocumentPaths 将新标签覆盖旧来源；buildChatContextSnapshot 将活动标签正文混入别的来源身份。Codex 模型和连接检测成功但 thread/start 在 Windows 出错。云库使用 ItemKind 而非生产文件类型路由，跨 realm ArrayBuffer 判空，目录不能真实展开。

执行分工：root 负责聊天与上下文集成；cloud_folder_reliability 负责云树和生产查看器；harness_execution_reliability 负责原生桥接与唯一真实请求预算；conversation_targeting 负责纯来源定位 helper 和回归。
