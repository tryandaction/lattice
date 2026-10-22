# 2026-10-17 云库 20 MiB 生产升级与合成验收

本轮沿用户已明确授权的部署与临时账号验收范围更新 Supabase 项目 `gxsauhzganbnqflmlpnk`。没有读取用户论文/私人正文，没有模型请求；管理授权仅在验收进程内存中取得，用于项目元数据查询、创建及清理本次合成账号。产品上传/下载/角色/健康/abort 路径全部转发真实使用者 JWT，不使用管理 key 绕过 RLS。

## 只读预检与迁移

迁移前用已登录的本机 Supabase CLI 通过官方 Management API 只读核验：准确项目、7 份迁移、私有 `lattice-shared-library` 桶 5,242,880 字节、active/expired 会话均0、桶对象数0、服务额度950,000,000字节。相关6个函数定义、Storage RLS 策略和桶/账本元数据保存到本地审计；未查询私人内容。Storage 仅有本库 INSERT/SELECT/DELETE 三条策略，无宽泛 UPDATE。

只应用并登记 `202610170001_cloud_large_objects.sql`，事务包含“恰好7份旧迁移且第八份尚不存在”的前置检查，未重放旧迁移。应用后账本8份，桶仍private，上限20,971,520字节。未删除既有用户数据。

运行 `node scripts/prepare-supabase-cloud-function.mjs` 生成同源 Edge 入口后，仅部署 `shared-library-api`，初次版本由3更新为4；当日后续两个P2修复后再部署为5。最终官方函数元数据：`ACTIVE`、版本5、`verify_jwt=true`；未传 `--no-verify-jwt` 或 prune。

## 真实托管验收

创建2个随机临时账号，使用正常密码登录得到用户 JWT；一个创建私有合成库，另一个通过邀请加入。合法PDF由本地 `pdf-lib` 生成，使用合成填充流与合法注释补齐到精确20MiB，并在上传前成功重新解析为1页。

最终完整运行18项通过：

1. 两个真实 Auth 登录。
2. 私有库创建。
3. 第二成员邀请加入。
4. 合法合成PDF精确20,971,520字节，SHA-256=`3eeaac02fd35dfe99c825466d03aea7cbd6cfd5a2de85bc6b44a81b76a27b354`。
5. 首次上传成功持久化后丢弃响应，outbox保留协商session与完整本地字节。
6. 关闭并重新初始化客户端控制器，同一会话整对象第2次请求完成，未创建重复blob。
7. 第二成员下载20MiB，精确长度与SHA一致。
8. admin health/capacity状态ok。
9. editor无权读取admin health。
10. viewer上传拒绝403。
11. viewer仍有权读取相同PDF。
12. 撤销成员后读取库数据拒绝403。
13. 用户JWT清理未提交物理对象，重复abort幂等，管理SQL确认该对象元数据不存在。
14. 声明10字节而提交9字节被拒绝400，abort后释放预留。
15. 20MiB+1初始化拒绝413。
16. usage精确等于20MiB、reserved=0、maxFileBytes=20MiB。
17. 过期清理空批次返回cleaned=0。
18. 本次合成库/组织/blob/session/Storage对象/账号清理，管理SQL逐项确认0。

最终完整运行，含故意丢失响应、重启和完成的上传耗时16,120ms；第二成员刷新与下载耗时5,707ms。这是本次链路测量，不作为长期SLA或跨网络性能保证。此实现是整对象重试，未提供TUS字节偏移续传。

首轮曾通过20MiB重试/下载/health后，验收脚本误用已dispose的旧控制器中止后续角色步骤；已清理六类残留为0，再修正脚本引用并完成上述18项。首轮失败报告独立保留，未当作产品通过证据。

## 清理与最终状态

自动审批最初因清理范围/证明不足拒绝验收脚本，且未创建临时账号。随后只读核验数据库FK，补强为：核对本次库created_by与账号验收marker；只清理本次库前缀Storage key；先Storage API物理删除并用管理SQL核实0；显式删除本次库、组织、marker账号；最终通过管理SQL精确ID检查六项0。补强版本获批后执行。

最终只读生产状态：迁移总数8，第八迁移1条；private20MiB；active0、expired active0、bucket objects0；本轮验收marker临时账号0；anon不能执行health RPC。未导出密钥、未保留临时账号密码/JWT，也没有删除原有用户资料。

证据目录：`.lattice-build/cloud-service-setup-20261017-supabase/`。

- `production-before.json`：迁移前函数定义/策略/元数据。
- `production-migration.json`、`production-deploy.json`、`production-functions-after.json`、`production-after.json`：部署与最终状态。
- `live-acceptance-attempt-1.json`：首轮脚本错误与当轮已清理证据。
- `live-acceptance.json`：完整18项、SHA与耗时。
- `cleanup-schema-proof.json`、`cleanup-verification*.json`：清理范围与六类零残留。
- `live-large-acceptance.mjs`、`operator-production.mjs`：可审阅的执行脚本，凭据仅内存。

## P2 恢复边界修复与 Edge v5 验收

最后集成只读复核发现两个边界，并在同日修复：原超时在 fetch 响应头返回后清除，正文读取可能停滞；原分片重试发现已有对象 hash 不符时只返回422，客户端仍使用旧会话而卡在相同冲突。

修复前先红回归：`api-transport.test.ts` 新增5项失败，覆盖 arrayBuffer/text 正文超时、headers后用户取消、正文网络错误映射；`supabase-storage.test.ts` 2项失败，证明冲突对象未清理且清理失败未保留可重试状态；真实本地 HTTP+RLS 回归观察到旧会话仍 active。修复后最终7组65项定向测试通过，定向 typecheck及范围ESLint通过；SQL无需新增迁移。

现在超时/取消持续覆盖到 arrayBuffer/text 读取完成。定时器先以 `request timed out` 拒绝再abort，超时映射为可重试 `NETWORK_ERROR`，只有调用方取消映射 `AbortError`；finally移除外部及内部取消监听。正文读取失败也进入相同网络错误映射。

冲突清理现在按“Storage API实际删除→读回确认不存在→DB标记aborted”顺序执行；任何一步失败保留原身份/预留，且仍可重试或调用abort。数据库原有session锁与Storage RLS继续禁止删除已提交blob。成功冲突清理后，客户端记录恢复标记，用户重试先幂等abort确认，再分配新操作/上传身份，保留原始本地字节；abort失败不丢旧身份。回归额外覆盖Storage成功响应却未删除、清理不可用以及已提交对象保护。

Edge v4→v5完成并保持verify_jwt=true。用新的2个临时账号与仅42字节合成对象进行故障注入，最终10项通过：登录、hash冲突保留可恢复身份、冲突物理字节删除且DB aborted、新身份retry、上传完成、另一成员下载SHA、真实下载headers后body取消、正文超时映射、已提交blob保留、六类清理0。正文超时使用真实Supabase私有下载响应，客户端在接到headers及首段字节后故意不关闭body；5秒预算在5010ms结束，错误为 `NETWORK_ERROR`、retryable=true、message=`request timed out`。这证明客户端body控制边界，不宣称生产网络本身发生故障。

首轮小对象验收在取消已通过后，验收脚本未捕获 `reader.cancel()` 的拒绝导致Node退出，未完成finally。随后只针对专用marker临时用户，额外核对组织created_by、组织内恰好本次库、无其他成员等归属，执行Storage物理删除后显式清理，管理SQL六类0；没有把中断当作完整通过。修正脚本的取消与stream异常处理后重跑上述10项，正常exit0且finally再确认六类0。产品源码在root门禁期间保持冻结。

补充证据：`live-p2-acceptance.json`、`cleanup-p2-verification.json`（最终完整通过）；`cleanup-p2-interrupted-verification.json`（前次异常后六类0）；`production-functions-after.json`（版本5/JWT true）。模型请求0、私人文件0；未再重复20MiB生产上传。

客户端公开 `maxFileBytes`、全仓库gate、桌面和网页最终发布由主窗口统一。健康检查/对象导出工具已提供，生产定时任务、通知、JWT刷新、全项目备份、真实恢复项目及SMTP/收费告警未在本轮擅自创建，仍按[云库运维方案](../operations/cloud-library-operations.md)推进。
