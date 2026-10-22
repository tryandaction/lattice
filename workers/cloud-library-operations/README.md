# 独立云库运维 Worker

当前为运营侧独立实现，没有生产部署。Cron 每五分钟执行，SQLite Durable Object 保存身份轮换、通知队列和状态，普通客户端不持有任何运营密钥。公共 HTTP 一律 404，workers_dev/preview_urls 关闭。

## 部署前置与身份

运营者先确认 Cloudflare 账号的 Cron、SQLite Durable Object 和请求配额及费用，再填入 wrangler.toml 的 API_URL、LIBRARY_ID、SUPABASE_URL、SUPABASE_PUBLIC_KEY 和 OPERATOR_USER_ID。API_URL 可以包含已有网关路径；其余 URL 必须 HTTPS，不允许认证信息、query/hash 或自动重定向。

OPERATOR_REFRESH_TOKEN、NOTIFICATION_TOKEN 使用服务端 secret。专用运营账号按现有 RLS 获得目标库最小必要权限；现有健康 RPC 要求 admin/owner，editor 无法替代。这不是数据库 service role，也不能用个人普通会话。刷新响应的 user.id 必须匹配 OPERATOR_USER_ID，轮换后的刷新凭据先持久化，随后才请求健康检查。短期 access JWT 不固定在定时任务中。

刷新会话独立于桌面，但并非永久有效：Supabase 会话时限、撤权或失效仍需运营者重新授权。持久化失败立即失败，不继续健康探针。不要覆盖 Durable Object 状态或重新使用已很久以前轮换的 bootstrap 凭据。一个部署只管理一个库；更换 API/库/账号会被 target hash 拒绝，需要明确的状态迁移。

### 失效后的版本化重新授权

替换初始 `OPERATOR_REFRESH_TOKEN` 不会覆盖已有轮转会话。重新授权使用独立的 `OPERATOR_REAUTHORIZATION_REFRESH_TOKEN` 服务端 secret，并将非秘密配置 `OPERATOR_REAUTHORIZATION_VERSION` 设为下一个整数。已有旧状态的版本基线为 0；第一次为字符串 `"1"`，之后必须精确加 1，不接受跳号、回退或前导零。

这仍是运营者明确执行的操作，不提供公共重置或登录路由。先通过获准登录流程获得同一项目、同一 `OPERATOR_USER_ID` 的新会话；配置新 secret 与下一版本后，下一次 Cron 将尝试一次刷新。错误账号、当前持久 token、原 bootstrap token 或上一重新授权 token 的重复使用均被拒绝。目标 hash 保持不变；缺失原状态/会话时直接失败，不能通过创建空状态来“恢复”。

只有账号验证通过、新轮转凭据与版本同次持久化成功后，才继续健康探针。保存重试最多三次，重试同一个已验证快照，不再次请求远端刷新。旧 outbox、事件 ID/序号、attempts 与 nextAttemptAt 原样保留；正常健康变化仍可按原规则追加恢复事件。远端轮转与本地存储之间没有跨系统原子事务，三次保存均失败需要运营者处理，不能宣称自动完成重新授权。

成功后**保留已接受的版本配置**；同版本启动只使用持久轮转会话，不重复消费重新授权 secret。该 secret 可在成功后从服务端 secret 中移除；不要移除或回退版本。下一次授权必须使用新 token 与下一版本。实现仅保留上一输入的 SHA-256 指纹用于防误重用，不将该指纹或任何凭据放入通知/结果。

## 离线部署预检与脱敏状态

`node "scripts/cloud-library-operations-preflight.mjs"` 默认只输出未配置结果，退出2。它不读取进程环境、wrangler/secret 文件，不发现系统账号，不请求网络、不安装任务或部署。通过 `--stdin-json` 显式提供最多64KiB JSON时也仅做结构与配置校验：

```json
{
  "version": 1,
  "vars": {
    "API_URL": "https://api.example.test/base",
    "SUPABASE_URL": "https://auth.example.test",
    "SUPABASE_PUBLIC_KEY": "synthetic-public-key",
    "LIBRARY_ID": "synthetic-library",
    "OPERATOR_USER_ID": "synthetic-operator",
    "NOTIFICATION_URL": "https://notify.example.test/events",
    "EXPECTED_VENDOR_PROVIDERS": "supabase,cloudflare",
    "CLEANUP_ENABLED": "false"
  },
  "secrets": { "OPERATOR_REFRESH_TOKEN": true, "NOTIFICATION_TOKEN": true },
  "bindings": { "OPERATIONS": true, "VENDOR_USAGE": true },
  "cron": "*/5 * * * *"
}
```

输入 `secrets` **只接收存在性布尔值**，不得放实际 token/JWT。运营者在获准上下文中检查存在性后提供布尔值；预检不会读取或验证实际 secret。服务绑定同理只报告显式声明，不能证明已部署或可调用。配置全为 `configured-unverified`/退出0；缺项或不可用为 `blocked`/退出2，未知字段/错误类型/坏JSON为 `invalid_input`/退出2。任何结果固定 `deploymentVerified=false`、`networkRequests=0`。不回显 URL、库/账号ID、公开key或输入错误正文。

重新授权版本与候选secret存在性也只属于配置校验；未提供snapshot时不确认原DO状态存在或候选会话可用，部署前仍需按重新授权契约执行。本工具不消费候选token，也不绕过持久状态校验。

可提供 `snapshot`，结构为：`version:1`、`lastCheckAt`、`lastSuccessfulCheckAt`、`identity`、`health`、`vendor`、`queue:{count,oldestAt}`、`lastAcknowledgementAt`。时间一律 UTC ISO 毫秒字符串（例如 `2026-10-21T10:00:00.000Z`）或null；queue count为0时oldestAt必须null，非0时必须有有效且不在未来的时间。identity只取 `unknown/available/refresh_required/unavailable`，health/vendor只取 `unknown/ok/warning/critical`。未知字段（含session/token/email、队列嵌套未知字段）直接拒绝，不清洗后继续接受；不能把原DO状态粘贴到stdin。

摘要返回最近检查/历史最后成功、身份枚举、队列数/最老时间和年龄、最近确认时间；不包含事件ID、收据ID、用户ID或任何凭据。距最近检查超过15分钟标记 stale；无记录标记 never_checked。历史最后成功不能晚于最近检查或当前时间。提供快照只是操作者声明，不变成实时验证；已知身份 unavailable 且未声明新重新授权输入时阻断，旧bootstrap存在不能掩盖失效。

服务内部可调用 `summarizeOperationsState` 直接从DO state投影白名单；原始state不会离开服务。原有内部 `/tick` 结果增加 `summary`，公共 Worker仍返回404，未新增公开状态接口。`lastSuccessfulCheckAt` 仅在本次health和vendor都ok时更新，网络/鉴权/费用warning或critical保留上次成功；旧状态不会凭空补历史成功。通知投递成功与健康检查成功分开，通知确认只来自既有lastReceipt。完整配置、状态新鲜或一条回执都不证明生产Cron/供应商费用/真实渠道已验收。

## 通知契约

- 初次网络/超时失败不通知，连续第二次才降级；鉴权失效立即通知。已有 critical 故障转为鉴权故障也通知。暂时失败不会误报恢复。
- 健康/存储容量与供应商用量/费用各自生成事件，不互相代替。
- 事件与重试时间先持久化；稳定 ID 通过 Idempotency-Key 和 JSON id 发送。按事件顺序投递，单次最多三条。
- 接收器须按 ID 持久去重，并在真正接受通知后返回 HTTP 200 与 accepted=true、相同 eventId 和非空 receiptId。202、普通 200 或错误 ID 不确认。
- 接收后本地确认保存失败会重投同一 ID，因此接收器幂等是必要条件。失败从 30 秒指数退避至最多一小时，Durable Object alarm 负责重试。
- 队列最多 100 条，满时失败而不丢旧事件；Cloudflare 运行失败、平台故障及账号停用还需平台独立告警。

没有已有明确授权的通知渠道时不要配置 URL/token 或发送测试消息。原始上游错误、凭据和响应正文不写入通知结果。

## 供应商费用适配

VENDOR_USAGE 为单独 service binding。未接入返回 VENDOR_USAGE_UNAVAILABLE critical，不用库容量代替账单。必须显式配置 `EXPECTED_VENDOR_PROVIDERS`，如 `supabase,cloudflare`；1 至 10 个大小写敏感的唯一标识，逗号两侧空白会被忽略，空项/重名/非法字符拒绝。没有期望集合返回 `VENDOR_USAGE_CONFIG_INVALID`，不会猜测部署使用了哪些供应商。

适配器请求 https://vendor-usage.internal/v1/usage，须返回 version=1、checkedAt 及非空 providers 数组。响应与每一供应商分别包含真实采集时间 `checkedAt`；均不得早于检查时刻一小时，最多容忍未来一分钟时钟偏差。顶层新时间不能掩盖供应商旧缓存。每项还含唯一 provider、**当前 UTC 年月** `period`（例如 `2026-10`）、requestRatio（实际请求/批准配额）、costRatio（实际费用/批准预算）。返回集合必须与期望集合完全一致，漏项或多项为 `VENDOR_USAGE_COVERAGE_INVALID`；旧账期、缺失/过期/未来时间、重复项或非法比率为 `VENDOR_USAGE_STALE_OR_INVALID`。0.8 warning、0.9 critical，费用与请求分子/批准预算必须真实，比例不能猜测。

本轮契约升级要求既有适配器补每项时间及期望供应商配置；未升级返回 critical，不沿用旧响应显示正常。UTC 月切换后上一账期即不满足当前检查，即使仅过去数分钟；适配器需据此提供当前账期，不能拿新采集时间包装旧账单。

供应商账号只读 API、预算和接收渠道尚未提供时保持未接入；供应商 dashboard 的用量和费用预算通知也需单独配置、真实验收。此模块没有偷偷创建资源或申请付费方案。

## 受控清理

CLEANUP_ENABLED 默认 false。只有显式 true 且 CLEANUP_LIBRARY_ID 与 LIBRARY_ID 一致时，才通过现有受 RLS 控制的 /uploads/cleanup API 执行一次最多25条。moreMayRemain=true 留待下一次。Worker 不直接删 Storage/R2，不触碰已提交历史对象；没有明确授权不启用。

## 离线加密恢复

scripts/cloud-library-recovery-archive.mjs 只封存已存在并经独立全项目清单验证的恢复点，不生成数据库 dump，也不连接生产。AES-256-GCM、随机 nonce、认证头部、流式压缩；通过运营进程环境 LATTICE_RECOVERY_KEY_BASE64 提供独立32字节密钥。密钥不得放命令行、恢复目录或备份包。

命令：node "scripts/cloud-library-recovery-archive.mjs" seal "<recovery-root>" "<independent-path>/point.lattice-backup" "<source-inventory.json>"；解密：node "scripts/cloud-library-recovery-archive.mjs" open "<archive>" "<new-isolated-output>"。

输出必须在源之外且不存在。声明工件、所有库 manifest（含空库）、全部物理对象和独立来源清单均纳入包；无关文件不打包，读取期间变化导致失败。加密临时文件完成认证标签后才排他发布。

解密先完成GCM认证，再向新隔离目录解压。拒绝绝对路径、点路径、反斜杠、重复条目和符号链接；默认解包总量上限100GiB。SHA256与原恢复校验器都通过才写 verified-recovery.json。失败目录可能留下部分文件，但不留成功标记，不在原目录重试覆盖。

压缩明文临时文件以0600权限创建于目标旁，正常结束删除；使用受控且加密的介质，强制中断残留按运维安全流程处理。程序不自动删除已发布备份、不自行实施保留期。路径位于源外不能证明离机，independentStorageVerified=false；离线解密不能证明独立Supabase/Auth/RLS还原，productionRestoreVerified=false。

## 本地恢复点组装与副本保留规划

`scripts/cloud-library-recovery-assemble.mjs <local-plan.json> <new-output>` 默认只读预检，不读取环境密钥、不联网、不写目录。加 `--assemble` 才向新目录复制已导出的工件。计划相对路径以计划文件目录为准，拒绝符号链接、源内输出和已有输出。每个工件与库必须声明同一 `snapshotId`；项目清单须是完整项目范围，包含空库和所有历史对象。哈希检查的是实际字节，操作者声明的维护窗口并不因此获得生产一致性证明。

新恢复点为 v2，`complete`、快照ID、独立来源清单原始SHA256及 `full-project` scope 均由恢复校验器强制检查。清单被替换、字节改变、缺失绑定、历史对象遗漏或工件损坏均不得封装。旧v1仅保留离线兼容，返回 `sourceInventoryBound=false`、`legacy-unbound`，不能作为新版副本回执。

计划格式见 [离线恢复操作说明](../../docs/operations/cloud-recovery-offline.md)。组装器消费已经存在的数据库导出；四schema共享快照获取和独立空库恢复由 [原生PostgreSQL工具](../../docs/operations/cloud-postgres-recovery.md) 提供，15项真实本机/边界回归与独立复审通过。托管Supabase平台兼容、物理Storage写回及生产端到端恢复尚未完成，不等于已经上线。

`scripts/cloud-library-recovery-retention.mjs verify-copy <source> <copy> <sha256> <new-restore-root>` 默认仅检查参数。加 `--verify` 时才通过运营进程环境 `LATTICE_RECOVERY_KEY_BASE64` 读取独立密钥，对源归档/副本双哈希、拒绝同路径或硬链接，实际从副本解密到新目录并核对v2恢复点。不同路径不证明不同介质，因此始终 `independentStorageVerified=false`、`productionRestoreVerified=false`。

`plan-retention <local-catalog.json>` 重新哈希每份回执绑定的归档，只返回保留项和删除候选ID。至少保留每项目2个不同快照，默认3个；保留期默认30天，窗口内和受保护快照的全部副本均保留。同快照副本不增加独立恢复点数量，同SHA绑定不同身份拒绝。日期与回执属于运营者维护的本地元数据；命令始终 `filesDeleted=0`，不执行删除或自动保留期清理。

## 内部通知接收与渠道交付

监控器优先通过 `NOTIFICATIONS` Durable Object binding 投递，无需新增公开Webhook。`NotificationDelivery` 每个事件ID使用独立SQLite状态；持久化pending并安排下一次alarm后才调用 `NOTIFICATION_CHANNEL` service binding。只有渠道返回HTTP200、`accepted=true`、相同eventId及有效receiptId并持久化交付结果后，才向监控器确认。失败返回503，alarm以30秒起步、最多1小时退避；重启后继续原ID。完成事件重复请求返回原回执，ID相同但内容改变返回409。

渠道适配器必须自行持久幂等；渠道已接受但本地确认保存失败时会再次发送相同ID，不宣称跨系统exactly-once。未配置渠道时保持pending，不生成虚假确认。原有显式HTTPS `NOTIFICATION_URL` 模式继续兼容；公开Worker路由仍404。`v2-notification-delivery`迁移仅提供部署材料，本轮没有部署或发送真实通知。

实际本地workerd使用SQLite重启和保存的alarm重试，通过2次尝试/1条唯一合成通知，重复读取相同回执；外部网络和真实通知均为0。生产渠道授权、服务身份、供应商账单/预算权限仍需运营落实。

## 本地验证

npx vitest run "workers/cloud-library-operations/src/operations.test.ts" "workers/cloud-library-operations/src/followup.test.ts" "workers/cloud-library-operations/src/recovery-archive.test.ts" --maxWorkers=1

node "scripts/cloud-library-operations-smoke.mjs" "<installed-miniflare-entry>" ".lattice-build/operations-smoke-unique"

2026-10-21 费用契约升级后，演练合成 fixture 已补 EXPECTED_VENDOR_PROVIDERS 与每项 checkedAt，账期按当前 UTC 年月生成；每阶段额外断言 vendor 正常，避免费用故障混入健康通知计数。新增两项边界回归由 operations/followup 定向测试覆盖。

演练运行真正的 workerd scheduled handler 和SQLite持久对象，所有网络均拦截到合成服务。重启后 pending 队列保留，相同ID重试和恢复通知得到验证；不等于已部署Cron或真实通知。synthetic-retry 只存在于.lattice-build中的测试wrapper，生产代码没有该入口。

官方依据：Cloudflare Cron Triggers、SQLite Durable Objects与alarms；Supabase Auth refresh_token轮换。Context7结果和实测均记录。本机workerd拒绝redirect:error，因此生产请求使用manual并拒绝非成功响应。
