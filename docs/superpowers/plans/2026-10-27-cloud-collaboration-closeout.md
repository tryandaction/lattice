# 云端库协作收尾实施计划

**目标：** 在现有本地工作区落实云端共享、PDF 批注可见性、云端 AI 和可追溯版本。

**架构：** 复用现有 controller/outbox/API 与主阅读器，按职责补齐界面及历史接口。

**规格：** ../specs/2026-10-27-cloud-collaboration-closeout-design.md

## Todo

- [x] completed：审查现有云库、PDF、AI、版本与成员实现，明确增量设计。
- [x] completed：并行实现互不重叠的 PDF 显示、历史数据接口和 AI 入口，整合云文件工具条及历史面板。
- [x] completed：验证多成员/多版本/草稿/离线/身份切换，修复恢复事务取消、批注确认与 AI 撤销问题。
- [x] completed：完成 lint、typecheck、文档检查、全量 5,503 项测试、生产 Web 构建及生产静态产物双作者协作验收，更新指南和交接。

## 任务及验收

1. PDF：新增视图偏好及控件，接入主 PDF 页面与侧栏。测试过滤本人/他人/个别作者、隐藏不写入、不丢批注及持久化隔离。
2. 历史：controller 新增 listVersions/readVersion/restoreVersion，返回 ItemVersion/SharedLibraryItemContent/新版本 ID。测试旧文件 hash、跨条目拒绝、恢复新版本及并发基线。
3. AI：复用云来源与既有聊天入口，在文件/目录上下文选择真实来源。验证账号切换、角色、模型未配置与具体提案审查。
4. 整合：CloudFileViewer 顶部轻量工具条和历史面板；保持 PDF 阅读器剩余高度正确，保护未保存草稿；复用管理弹层。
5. 验证：定向 vitest、ESLint、typecheck、相关 Worker 合约、浏览器交互和 qa:gate 的 Web 相关阶段。按用户 2026-10-27 补充指示，本窗口不更新桌面产品、不运行桌面打包/安装或刷新 releases；桌面交付由其他窗口统一处理。无授权不进行 Git 写操作或远程发布。

## 完成证据

见 `docs/tests/2026-10-27-cloud-collaboration-closeout.md`。原始 `qa:gate` 全量测试通过后受 `.next/trace` 沙箱写入限制在 Web 构建退出 1；同一源码的 `npm run build` 随后以审批允许的执行模式通过。Tauri 阶段遵照用户指示未执行，不将整条含桌面打包的命令声称为通过。
