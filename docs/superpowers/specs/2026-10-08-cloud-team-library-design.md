# 云端小组文件夹库设计

规格：`docs/development-prompts/2026-10-08-cloud-team-library.md`。用户已授权自主设计实现。

## 根因和范围

现有默认路由是 local_only；RemoteContentStore 写入拒绝，而 Store 保存沿本地 put/version 路径；sync/push 仅追加日志；版本端点无原子 compare-and-swap；无产品登录/成员/邀请接线；PDF使用旧阅读器；动态导出占位路径无法保证 Tauri 任意ID刷新。

新增专用连接/Auth、IndexedDB事务 outbox、本地投影与真实HTTP调度、工作区入口和source provider。保留现有本地库，沿用 viewer，不触碰主窗口独占文件。云缓存作用域 connection/user/library/item，不以文件名作为身份。

## 成本方案（2026-10-08 查询官方页）

| 方案 | 建设与运维 | 额度/传输 | 选择 |
| --- | --- | --- | --- |
| Supabase Auth/Postgres/Storage | 单栈运维少，需重写既有R2协议 | Free：500MB数据库、1GB文件、5GB egress；一周不活跃暂停；Pro从$25/月 | 不选，现有R2已经具备分片链路 |
| Supabase Auth/Postgres + Worker/R2 | 复用现有协议、RLS和上传；两服务配置 | R2 Standard免费10GB-month、1M Class A/10M Class B、egress免费；超额存储$0.015/GB-month；Workers Free 100k请求/日，10ms CPU/次；Paid至少$5/月 | 默认，降低重写和文件下载成本 |
| WebDAV/自托管 | 需自建权限、邀请、冲突、索引、备份、运维 | 主机/流量/备份费用依运营方，无通用免费承诺 | 不选，协议不覆盖现有协作模型 |

来源：[R2](https://developers.cloudflare.com/r2/pricing/)、[Supabase](https://supabase.com/pricing)、[Workers](https://developers.cloudflare.com/workers/platform/pricing/)。这是额度内成本规划，非已创建或无限免费服务。

## 架构与可靠性

1. 连接仅存公开 Worker URL、Supabase URL、publishable/anon key及本地大小限额，拒绝secret/service-role key。Supabase Auth REST password/refresh/logout，不新增SDK依赖。刷新single-flight，网络失败保留会话，退出立即隔离source和缓存；Desktop通过现有secure命令。
2. IndexedDB存原bytes和结构化metadata/outbox；一次事务写入保存内容和队列后返回。上传计划先持久化，逐片etag写回可恢复/暂停；不清理未完成操作。scope完全分离，dispose阻止后续请求。
3. 队列真正执行HTTP metadata/上传/version/annotation操作，稳定UUID作为重试身份。后端事务提交版本锁定item并验证baseVersion和blob归属/hash；旧版本保留。409保留本地内容与远端引用，用户选择采用远端、保留本地（显式新版本）或副本。
4. 文件夹用稳定parent item ID（目录也是item），路径是展示信息；服务端拒绝路径遍历、父级跨库、循环及同名，移动改名不改子文件ID。浏览器导入目录不跟随本机symlink；云端未知MIME仍存bytes，支持下载，不承诺均可编辑。
5. 每次在线读取和同步重新验证成员；撤销后namespace锁定，缓存保留隔离，HTTP/RLS拒绝搜索/内容。离线撤销无法即时获知，已导出副本不能遥控删除，文档诚实说明。
6. 邀请使用256-bit随机token，仅hash入DB，期限、撤销、接受绑定邮箱、重复接受幂等，URL不含Auth token；角色由API/RLS执行。
7. 内嵌工作区树、面包屑、标签/分栏连续阅读；同库条目lazy读取。复用主PDF高亮适配器与Markdown/Code/Notebook/Word/PPT/Image；需要共享renderer外部批注接口时用明确handoff请求。
8. Provider list/read/search返回稳定身份、角色、版本与真实content，搜索snippet不冒充全文；无自动OCR/embedding，索引按需。

## 验证分层

 focused unit/contract → 双profile真实HTTP Worker handler/R2适配器 → 可用隔离Postgres RLS（若环境没有则显式未执行）→3538浏览器真实点击和三主题。仅用生成测试文件，无个人文档。全量release/构建/安装归主窗口。
