# 云端小组文件夹库 Implementation Plan

**Goal:** 完成已授权云库能力链路和可审查交接。
**Architecture:** 连接/Auth → scoped事务缓存和outbox → Worker/R2/RLS → 嵌入主工作区和受限provider。
**Tech Stack:** Next/React/Zustand、IndexedDB、Supabase REST/RLS、Worker/R2，无依赖升级。
**Spec:** `docs/superpowers/specs/2026-10-08-cloud-team-library-design.md`

## Global Constraints

只写委托归属；版本3.1.0不变；禁止提交/分支/新worktree/部署/生产凭据/计费；dev3538与独立dist；主窗口最终发布。用户已明确授权inline自主执行，不重复审批、不创建子线程。

## Todo

- completed：读取规格/根因/价格和Auth官方文档；handoff提前发布精确接口。
- completed：连接/Auth和持久化 local-first workspace 接线。
- completed：Worker/RLS 事务版本、目录、邀请、批注 CAS 与撤销权限闭环。
- completed：文件树/标签/分栏、多格式 viewer、source provider、active/sourceVersion contract。
- completed：最后证据固化、交接审计与源码冻结。全局typecheck exit0；归属33文件/208用例及专用浏览器门禁通过。主窗口已读取接受交接，并接手renderer精准定位、多格式交互/执行隔离、Native/静态发布与完整产品门禁。

## 执行与测试

1. `connection.ts`：校验连接URL和公开key；`supabase-auth.ts`：signIn/refresh/logout、重开和single-flight；tests先验证拒绝secret、网络刷新保留、账号隔离。
2. `cloud-persistence.ts`：通用transaction records，测试persist失败不报保存；`cloud-workspace.ts`：snapshot/items/content/outbox，测试断网保存→重开→真实HTTP回放、CAS409保留双方、撤销锁缓存、namespace隔离。
3. Worker及追加migration：稳定item/annotation UUID、原子版本RPC、目录约束、成员与hash邀请；测试用真实handler HTTP，SQL环境可用则执行，否则保留未执行项。
4. `source-provider.ts`与`cloud-library-workspace.tsx`：嵌入props、folder import、面包屑、持续mounted标签和split、成员邀请与冲突、未知binary下载；复用content-viewer，PDF renderer接口请求写handoff。
5. `/library`查询ID静态入口、独立3538 browser smoke；focused Vitest、全局typecheck、docs 和指定eslint已通过。浏览器场景独立为 `.scenario.ts` + `vitest.browser.config.ts`，URL显式配置；默认单测不依赖dev端口。最终产品 `qa:gate`/Tauri发布归主窗口。

不运行全量qa:gate、Tauri build或release。完成交接后冻结归属源码，等待主窗口审查；Native/生产静态/精准定位与未部署云提供方的限制必须保留在handoff，Goal按完整验收判断。
