# Shared Library Smoke Checklist

这份清单用于验证共享研究库（Shared Library）端到端行为。自动化冒烟不依赖真实
Supabase / R2 / Cloudflare Worker，全部通过注入的 fake（repository / blob / job /
transport）运行。

## 1. 自动化冒烟（无需真实云资源）

### 独立 CLI（Node，无需 TypeScript loader）

```powershell
node scripts/shared-library-smoke.mjs
```

输出为 JSON，每步包含 `operationId`、`status`，失败时带 `reason`：

```json
{
  "steps": [{ "step": "create-library", "operationId": "device-1:1", "status": "ok" }],
  "summary": { "ok": 13, "failed": 0, "total": 13 }
}
```

- 全部步骤通过 → 退出码 0；任一步失败 → 退出码 1。
- 步骤契约（与 TS 单测一致）：
  `create-library → invite-member → upload-pdf → create-child-markdown → annotate →
  go-offline → resume → pull → search → delete → restore → snapshot-guard →
  conflict-classification`。
- `go-offline` 验证断网时 pending 操作**不丢失**；`resume` 验证恢复后重新推送。

### Vitest 契约测试

```powershell
npm run test:run -- src/lib/shared-library/__tests__/shared-library-e2e-contract.test.ts
```

该测试驱动真实的 `smoke-runner.ts`，以两个用户、两个设备走完整个生命周期，并断言：

- 创建 Library、邀请成员、上传 PDF（分片上传 + 版本）、创建子 Markdown、批注；
- 断网不丢操作、恢复后重新推送；
- 拉取远程操作；
- 搜索结果携带完整契约（`itemId / childItemId / sourceType / snippet / locator /
  permissionSnapshot / updatedAt`）；
- 删除与恢复；
- 快照 SSRF 防护与冲突分类可恢复性。

## 2. 浏览器手工流程（Web route）

- 打开 `/library`，确认三个视图层级：Library 列表 → Library 详情（items）→ Item workspace。
- 打开一个 PDF item，确认 viewer 挂载（`data-testid="library-item-workspace"`）。
- 在 PDF 上创建批注，确认批注位置可跳转（normalized geometry 在 Web/Desktop 一致）。
- 断开网络：确认 UI 同步状态进入 `offline`，且本地变更仍在。
- 制造冲突：确认 conflict panel 显示实体、双方版本、作者、时间、推荐动作，而不是只显示"同步失败"。
- viewer 角色登录：确认看不到成员管理与冲突解决入口。

## 3. 桌面手工流程（Tauri smoke）

- 登录回调：确认 OAuth 回调把会话写回安全存储（`shared_library_secure_*`）。
- 本地 workspace：确认 `ensurePdfItemWorkspace` 在桌面文件系统上创建/复用 item 目录。
- 队列恢复：写入一批操作后强退重启，确认 `BridgeSyncQueueStorage` 从持久化快照恢复并继续推送。
- 关闭/重启：确认后台 worker（`startBackgroundSync`）`dispose` 后不再推送，重启后重新调度。

## 4. 验收对照

- 未授权用户无法从 API、对象 URL、缓存或搜索读取内容（RLS / permission snapshot）。
- 离线变更重新联网后最终可见。
- 重复 operation 不产生重复实体（idempotency key 去重）。
- 冲突可见且不会静默覆盖。
- Item 子文件、版本、批注和回收站恢复关系完整。
- PDF、Markdown、代码、Notebook、Word、PPT、HTML 至少有正确 renderer 路由。
