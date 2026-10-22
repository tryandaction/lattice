# Lattice 云端小组文件夹库：独立窗口开发委托

## 用户授权与 Goal

用户明确要求再开两个正式窗口自主专业设计、开发和迭代，本窗口负责云端小组共享库，主窗口最后整合并更新本机产品 **3.1.0**。用户进一步明确“希望先低成本实现好的效果，选择最佳方式”。先调用 create_goal，目标是：将已有 Shared Library 接成可配置、可登录、能打开与同步的云端小组文件夹库，复用 Lattice 完整多格式阅读/编辑体验；完成权限、持久化、离线队列、冲突和双用户真实协议验收，向主窗口交付实现与可审查证据。只有本窗口实现及交接全部完成才设置 Goal complete。主窗口负责最终打包安装，不在此窗口安装。

用户已授权你自行专业设计实现、常规修复和隔离测试，先分析写设计与计划再执行，持续迭代；不因技能中的通用设计审批再停下来重复询问。必须准确记录实际限制，不把模拟、本地演示或未部署云服务叫作已上线。

## 已知根因与入口

先读 docs/guides/shared-library.md、docs/tests/shared-library-release-checklist.md、docs/operations/shared-library-runbook.md 和既有设计/计划。现有实现包括 src/lib/shared-library/**、src/stores/shared-library{,-sync}-store.ts、src/components/shared-library/**、src/app/library/**、workers/shared-library-api/**、supabase/migrations/**。现有文档明确默认页面是 local_only，真实登录身份、API 与同步调度尚未接好；不能仅以仓库测试或 HTTP200 宣称云端协作可用。

现有 createSharedLibraryRuntime 接 RemoteRepository、RemoteBlobStore、RemoteSharedLibraryContentStore、searchClient；AuthSessionManager 已有 refresh/device contract，Native main.rs 已有 shared_library_secure_*。PDF共享 content-viewer 当前使用旧 pdf-viewer；要核查它是否绕过本机主要 pdf-highlighter-adapter 的批注/公式/跨列跨页能力。复用真正的 Lattice viewer，不能为了云端重新做简陋阅读器。library-shell 目前以 Library→Item列表为主，需补树形层次与工作区连续体验。

## 技术方案与成本约束

默认沿现有 **Supabase Auth/Postgres/RLS + Cloudflare Worker/R2 + 本地缓存/持久化队列**，不为此另造后端或采用付费向量数据库。先比较 Supabase单栈Storage、现有R2组合和WebDAV/自托管三种的实际建设/运维成本，写清取舍；选用现有组合降低重写和多格式文件传输成本。API公开URL、Supabase公开项目URL/可公开客户端key可配置；service-role、R2凭据、管理员token不能进入客户端bundle。

成本依据需查当前官方页并记查询日期： https://developers.cloudflare.com/r2/pricing/ 、https://supabase.com/pricing 、https://developers.cloudflare.com/workers/platform/pricing/ 。R2当前Standard免费10GB-month、1M Class A/10M Class B请求和免费egress不是无限额度。元数据/索引不存binary，不重复上传未改内容；懒加载、增量cursor、内容hash缓存/去重、上传前可见大小和库额度限制、索引/缩略图按需且可重试，不自动后台OCR或收费embedding。Supabase Free休眠/配额要有可恢复反馈。

实际云租户、正式域名和部署凭据尚未提供；先把产品可配置接入、后端、迁移与隔离真实协议验收做完整，提供可部署包和简洁上线步骤。不得擅自创建计费账户/云资源、远程部署、执行生产迁移或邀约真实成员；主窗口会在部署需用户动作时处理具体信息。不要以缺生产凭据为由停止客户端开发和本地双设备验收。

## 必须交付的产品能力

1. **明确可达入口与持久连接**：现有主工作区可打开共享库，用户可以新增/编辑连接、登录/退出、重开恢复有效会话、token刷新、切账号/组织/库。显示真实 local_only/offline/syncing/synced/conflicted/failed，不硬编码演示owner。账号/库缓存隔离，登录失败不清空个人工作区或未同步编辑。云URL/深链接动态ID在静态导出和Tauri刷新后正确恢复，不能仅开发服务器可用。
2. **真正文件夹库**：目录层次、面包屑、稳定item/child IDs、拖拽或批量导入文件/目录、中文/空格/同名路径、移动/重命名及刷新。没有扩展名白名单阻止存储或同步；无法预览的格式给真实文件信息和可靠下载/外部打开。不要宣称任意格式均能编辑。路径遍历、符号链接越界、同名歧义、受限角色操作都要拒绝。
3. **Lattice浏览体验**：多标签/分栏与文件树，不丢当前阅读/编辑状态；PDF高亮/评论/公式、Markdown+LaTeX、代码、Notebook、DOCX/PPTX、图片/数据复用已发布viewer和主题token。真正远程binary/文本经过统一resolver，不把网络URL当本地路径，不下载到用户目录冒充“远程库”；未知格式可字节完整下载。打开多个库同名文件时身份不得混淆。
4. **研究条目与子文件**：PDF下Markdown/Notebook/图片/数据子文件、批注、版本和关联在远程编辑同步、父文件移动改名及重启后不丢。云端版本一致性、内容hash、批注坐标/page/quote不因不同设备变化；共同批注和评论能按权限读取/修改，并保留作者和时间。一个根目录“data文件”不能代替层次操作。
5. **小组协作闭环**：可创建库/成员邀请链接/加入/查看角色/变更和撤销；沿现有viewer/commenter/editor/admin/owner契约。权限在API和RLS实际执行，未经许可的内容下载、搜索、同步、缓存后续访问都禁止。撤销后停止同步并隔离当前缓存；已经下载到他人系统的副本无法遥控抹除，文档必须诚实。邀请链接有随机token/hash、期限、撤销、幂等接受，不能把访问token塞分享URL。
6. **离线可靠性**：先持久化本地变更/上传计划再显示保存成功；chunk upload可取消和恢复、hash校验、幂等、大小限制。断网重连、应用关闭再开、失败事务与后台dispose不能丢操作；冲突保留双方版本，可见且可以保留本地、采用远端或副本，不能last-write-wins静默覆盖。跨账号pending操作不串库，不清空队列掩盖失败。
7. **统一索引与AI接口**：库/目录/文件读取返回稳定library/item/version identity、有效权限、真实页/section定位。提供受限 list/read/search 接口供另一个AI窗口消费，不能把已索引的摘要冒充全文；公开接口建议写交接文件，由主窗口协调。云端搜索过滤权限，文件变更删除后增量更新索引和缓存，binary无可抽取文本要标注。
8. **简洁完整交互**：保持3.1.0五主题，少入口少重复；权限、同步和冲突是实际需要时可见。长任务进度、取消、失败后恢复；窄窗/键盘/焦点/菜单不能挡住viewer。没有云配置时呈现可用配置入口及本地库边界，不展示假团队和假在线状态。

## 文件归属及协作

你拥有 src/lib/shared-library/**、src/components/shared-library/**、src/stores/shared-library-store.ts、shared-library-sync-store.ts，src/app/library/**，workers/shared-library-api/**、supabase/**，相关测试/云库专属文档和新 src/components/diagnostics/cloud-library-diagnostics.tsx。必要新增模块优先放本归属。

主窗口独占 src/components/layout/**（AppLayout/文件导航/toolbar/入口）、src/components/settings/settings-dialog.tsx、src/lib/i18n*、src/types/settings.ts、src/stores/settings-store.ts、src/stores/workspace-store.ts、src/types/layout.ts、src/lib/storage-adapter.ts、src/app/layout.tsx、src/app/globals.css、src/components/renderers/**、src/lib/pdf-*、src-tauri/src/main.rs、依赖lock/版本/发行。对共享文件提出小而具体的接口/补丁要求写入 docs/tests/2026-10-08-cloud-team-library-handoff.md，主窗口落实；不能擅自覆盖或等待不必要的全量重写。你可新增专用 src-tauri/src/shared_library_*.rs，把main注册需求交主窗口；与AI窗口的Native文件互不相同。

AI窗口拥有AI相关 src/hooks/use-ai*.ts、src/components/ai/**、src/lib/ai/**、AI/Agent stores 与 src-tauri/src/agent_harness.rs；不得修改这些。需云库workspace provider契约时先写精确signature，由主窗口统一双方。

所有线程共享当前已有大量未提交修改，禁止git commit/push/reset/checkout/分支/新worktree及清理别人目录。不改版本3.1.0，不远程部署，不启动另一生产构建，不杀全局node/用户应用。开发服务独立 NEXT_DIST_DIR=.lattice-build/cloud-team-dev-20261008 / port3538；只停止自己确认的进程树。新Next必须先读node_modules/next/dist/docs相关指南。

## 验收与交接

先有范围清单与根因，再每项可独立测试交付；复杂失败先定位，不堆补丁。不靠组件mock证明真实双设备协作：使用两独立profile和真实HTTP API，Worker local/R2模拟运行器+可用隔离Postgres/RLS执行核心路径，模拟provider的范围明确标注。Docker可执行存在但daemon未确认；不可安装系统服务/自动下载巨镜像，缺本地依赖可用真实protocol server并把未执行RLS列明。不要接生产凭据绕过测试。

至少覆盖：登录/刷新/重开/退出账号隔离；A导入多格式嵌套目录→B获取列表/下载hash/查看PDF和MD；B有权限修改→A拉取；断网编辑/强退恢复队列→恢复推送；同时修改触发冲突；viewer越权被服务拒绝；移除成员后HTTP读取/搜索/下载拒绝；同名PDF不同库/父PDF移动后子文件与批注保持；unknown binary下载原bytes；大文件取消/失败恢复；静态/Tauri深链接刷新；三主题至少完整实际UI smoke。详细fake-vs-real分层记录，不以单测通过替代UI。

本窗口运行focused tests、typecheck、归属lint、docs校验和独立浏览器真实点击。全量 qa:gate、Tauri build及安装由主窗口在两边源码冻结后独占执行。交接文件写明根因→修复→证据路径、改动清单、共享文件请求、公开云连接配置、部署前唯一必需的环境项、成本与限制、剩余阻断。保持Goal active直到实现交接完整；完成后只读等待主窗口审查，收到新审查意见继续同一目标，不重复建任务。

对标文档：Zotero Groups https://www.zotero.org/support/groups ；群组和文件共享要求不是只换一个Library标题。不要自动使用用户Zotero数据库或个人文献。
