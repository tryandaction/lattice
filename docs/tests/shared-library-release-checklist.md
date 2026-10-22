# 共享研究库发布清单（Release Checklist）

> 发布前逐项核对。只有命令真实退出码为 0 才能把该阶段标记为完成。

## 1. 代码与质量门禁

```powershell
npm run lint
npm run typecheck
npm run test:docs
npm run test:run
npm run build
npm run qa:gate
```

- `npm run qa:gate` = `lint && typecheck && test:docs && test:run && build && tauri:build`。
- 最近一次全量测试：**352 个测试文件 / 2702 个用例**，退出码 0（共享库 + searchable-text + PDF + 编辑器 + Desktop/VSCODE 兼容层 + 对账）。

## 2. 共享库冒烟

```powershell
node scripts/shared-library-smoke.mjs            # 13 步，全绿退出码 0
npm run test:run -- src/lib/shared-library/__tests__/shared-library-e2e-contract.test.ts
```

云库正式产品门禁还必须执行专用真实UI场景（默认单测不依赖手工dev端口）：

```powershell
$env:CLOUD_LIBRARY_BROWSER_BASE_URL="http://127.0.0.1:3538" # 或production静态产物服务
$env:CLOUD_LIBRARY_BROWSER_ENTRY="/library" # 直接静态文件可用/library.html
npx vitest run --config "workers/shared-library-api/test-support/vitest.browser.config.ts"
```

应用服务须全程存活；场景自行启动隔离HTTP、PGlite/RLS、Auth/R2 fixture。缺URL、缺PGlite运行时或端口未运行时必须失败。详细步骤和真实/fixture边界见 `2026-10-08-cloud-team-library-handoff.md`。

## 3. PDF item 追踪对账

对每个真实工作区：

```powershell
node scripts/reconcile-pdf-items.mjs --workspace "<workspace>"          # dry-run 计划
node scripts/reconcile-pdf-items.mjs --workspace "<workspace>" --apply  # 备份后执行
```

验证：移动/重命名不再产生空 item；子文件、批注、`_annotations.md` 与
`.lattice/annotations/<itemId>.json` 在移动/重命名后仍可见；无重复条目。

## 4. 浏览器手工（Web route）

- [x] `/library` 三层工作区：Library 列表 → 详情 → Item workspace。
- [x] PDF 打开、页面批注创建、旧 Item 版本惰性迁移与深链接刷新。
- [x] Annotation comment 根评论/回复/编辑/软删除的本地与 Worker 契约测试。
- [ ] 离线状态显示与真实云端恢复推送（需要绑定 Auth/API/同步调度）。
- [ ] 冲突面板显示实体/双方版本/推荐动作，而非"同步失败"（组件已具备，入口接线待云端状态源）。
- [ ] viewer 看不到成员管理与冲突解决入口（需要真实登录角色数据）。

## 5. 桌面手工（Tauri）

- [ ] 登录回调写回安全存储（`shared_library_secure_*`）。
- [ ] 本地 workspace 创建/复用。
- [ ] 强退重启后队列从持久化快照恢复并继续推送。
- [ ] 后台 worker dispose 后停止推送，重启后重新调度。

## 5.1 云端文件闭环

- [x] Transport 支持认证 PUT/ArrayBuffer 和超时取消。
- [x] Worker R2 binding 路由覆盖创建会话、分片、完成、取消和受保护内容读取。
- [ ] 生产环境完成 R2 bucket policy、病毒扫描、生命周期清理和大文件压测。

## 6. 部署边界

- 本地 release 产物：仅按需刷新 `releases/<version>/`。
- 默认 Web 页面使用 local-first repository；Worker API、Supabase Auth/RLS 和 R2
  必须完成环境配置与部署验收后才可宣称云端协作已启用。
- 远程部署（Web/Cloudflare、GitHub Release）：**仅当用户明确要求**。
- Git commit / push：**仅当用户明确确认**。
