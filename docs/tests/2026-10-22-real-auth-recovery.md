# 本机真实 Auth 恢复验收

状态：真实Auth/PostgREST完整用例冻结后最终复跑通过，1项通过、0失败、0跳过；独立只读复审未发现阻塞P1/P2。本轮未改客户端，仍3.1.3；此记录不代表生产恢复上线。

## 隔离范围

- 所有数据库由 native-postgres fixture 在 `.lattice-build` 新建，绑定127.0.0.1随机端口；不使用已安装的数据库服务，不访问生产Supabase。
- SMTP为测试自身的loopback收信器，邮件只保存在内存；邮箱、密码、JWT密钥和全部材料均为新建合成值。未发真实邮件，未使用用户QQ SMTP，没有模型请求。
- Go工具链、模块缓存及可执行文件仅存于项目目录，不修改PATH、不安装系统服务。Docker引擎未运行；没有为了验收启动系统Docker服务。

## 固定工具来源

2026-10-22查询官方公共发布元数据后固定：Go1.27.3 Windows amd64归档SHA256 `f26081f438319757f8a1b46d7d0b2c5ec7583d4038e485e0aa725cfde7885fff`；PostgREST v16.5 Windows归档SHA256 `17f595b0d8dd37473d0231417dea07c5ac9f791282ff5b017fae51ff29e5de2f`；Supabase Auth v2.197.0源码提交 `4eee58f296d9698a1c2c0ae14d7a0b379c7622d3`。

Auth官方源码直接在Windows构建时失败：`cmd/serve_cmd.go`使用Unix `SO_REUSEPORT`。隔离验收副本只将监听器改为普通`net.ListenConfig{}`并删除Unix/syscall导入，未改数据库迁移、账号/JWT/密码/确认逻辑。生成二进制hash `eb2e14a755573ef98e202b9408ef21f7448d30d16b5cec6349b0c88713885925`。这不是官方Windows发布，也不会打包进Lattice产品。

## 当前记录

- `platform-auth-recovery-first.json`：官方Auth迁移需要`postgres`角色，最初合成集群没有该角色，setup失败；此项不是功能通过。
- `platform-auth-recovery-candidate.json`、`platform-auth-recovery-diagnostic.json`：注册返回500，实际诊断为连接未将`auth`设为搜索路径，导致查找identities失败。修正fixture连接搜索路径后继续验收；没有修改产品来掩盖失败。
- 初步验收随后扩展为下方完整候选链路：实际确认、导出/导入、恢复登录、成员权限和刷新退出；不是以早期失败记录冒充最终结果。

## 已通过的完整链路

`platform-auth-recovery-search-path.json` 单项真实确认/登录恢复通过。最终记录 `.lattice-build/turn-20261021/platform-auth-api-recovery-final.json` 包含1个完整端到端用例、0跳过，完整运行约78.6秒（包括隔离数据库初始化）：

1. 新建owner、viewer、outsider三个真实Auth合成账号，SMTP内存收取三封确认邮件并实际访问loopback确认链接。
2. 停止来源Auth，使用同快照捕获/受保护导入器恢复到已初始化空目标；保留原用户ID及密码验证数据。
3. 使用产品`SupabaseAuthRepository`向恢复后的Auth密码登录；错密码被拒绝。三个用户令牌来自实际Auth响应，不是测试伪签名用户令牌。
4. 通过当前`handleSupabaseEdgeRequest`处理器和官方PostgREST访问目标PostgreSQL：viewer可见2项文件、2个历史版本、1个PDF子文件、批注正文及协作者昵称；outsider和被撤权viewer均收到403，来源viewer状态仍active。
5. 产品Auth适配器实际refresh成功、logout成功，注销后该refresh token再次请求被拒绝。

最初PostgREST缺失`libpq.dll`而退出（`platform-auth-api-recovery-candidate.json`）；通过其子进程私有PATH指向已安装PG18的bin加载依赖，不修改系统或用户PATH。`platform-auth-api-recovery-libpq.json`已运行到outsider断言，测试错误地期待空列表200，而现有API正确拒绝403；修改测试断言后强化候选通过，没有放宽产品权限。早期失败记录继续保留。

独立审查额外将原始源码zip与构建源逐文件比对，确认仅监听器改动；程序实际hash与fixture固定值一致。PostgREST可执行文件hash为 `fbe713383e1b99e1be7b4aac2bc021304abd27101e9d7a440d4a6caab0b6c623`。fixture在启动前逐字节hash核对固定工具；显式提供错误或缺失的工具配置会失败，不静默跳过。未提供工具的普通测试环境会跳过此专项，因此普通全量绿灯不替代本机显式执行记录。

最终源码另通过全量TypeScript检查和新增两个TS文件的ESLint检查；文档检查207个文件通过。验收结束后检查未残留本轮Auth/PostgREST进程。客户端安装版本仍3.1.3，SHA256仍为`411deef9d1de054348560123528c1bfdcacd3ebf16e1eaf3fb45e685b7a2a151`；没有因专项测试重装客户端或改写用户配置。

## 复跑方式

工具准备与唯一Windows监听器补丁留在本机 `.lattice-build/turn-20261021/prepare-platform-auth-tools.ps1`、`build-platform-auth-windows.ps1`；源码固定提交与下载/构建日志也保留。准备脚本曾原样构建失败，不能将该脚本当自动通过的一键安装器。它们不是产品依赖，不进入安装包。

```powershell
$env:LATTICE_TEST_AUTH_BIN = (Resolve-Path ".lattice-build/platform-auth-tools-20261022/auth.exe").Path
$env:LATTICE_TEST_POSTGREST_BIN = (Resolve-Path ".lattice-build/platform-auth-tools-20261022/postgrest/postgrest.exe").Path
npx vitest run "workers/cloud-library-operations/src/platform-auth-recovery.test.ts" --maxWorkers=1
```

独立复核时不需要运行用户配置或读取其账号；fixture只创建自己的合成数据库和进程，测试结束后关闭自己创建的服务。

## 验证边界

验证恢复后创建的新登录会话，不声称来源旧session自动延续。本例20MiB为SQL blob描述符，未恢复物理Storage文件字节；没有运行官方Storage服务。API handler在本机Node网关调用，未执行托管Edge runtime。本机SMTP收信不代表QQ/生产邮件投递；MFA/SSO、平台根密钥、任意扩展、全局角色和托管配置仍未验证。

现有平台导入20项及独立复审结论见[平台导入记录](2026-10-22-platform-restore.md)。本记录不会自动把托管平台兼容、物理Storage服务、平台根密钥或生产运维资源标为已完成。
