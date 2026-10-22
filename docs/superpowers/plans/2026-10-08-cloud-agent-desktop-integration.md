# Lattice 云端协作与Agent双窗口整合计划

**Goal：** 两个独立窗口完成共享云库及Agent/harness，主窗口审查并更新已安装3.1.0。

**Architecture：** 复用Supabase/RLS+Worker/R2与本地队列，完成真实连接/身份/同步调度；AI复用原模型与证据体系，通过受限workspace provider和Native owned child连接官方harness协议。两个窗口各自设计/迭代，主窗口独占共享入口/Native注册/发布，freeze后串行全量构建。

**Spec：** docs/development-prompts/2026-10-08-cloud-team-library.md；docs/development-prompts/2026-10-08-agent-context-harness.md。用户已明确授权自主专业设计开发，低成本优先；发布版本保留3.1.0。

## Todo

- [x] 检查原有实现、已安装3.1.0和官方协议/成本，编写两个完整委托。
- [x] 新建两个正式窗口/Goal，核实active启动并协调文件分工。
- [x] 审查各自设计、根因及focused/UI/Native交接，落实共享入口与数据接口；两窗口已完成归属Goal并冻结，3538/3539自有服务已清理。
- [ ] **in_progress：新旧功能交叉验收：云权限与AI读取/写审查、远程PDF/子文件、会话重开/索引、五皮肤与插件兼容；修复原生关闭严格保存、共享批注导航和主工作区工具链。**
- [ ] 两窗口源码冻结，主窗口独占qa:gate、实际Native验收及canonical发行包。
- [ ] 保留旧3.1.0备份，更新本机3.1.0并核对hash/启动/重开，准确报告云上线与实际harness测试边界。

update_plan工具当前未提供，使用本文件维护pending/in_progress/completed，仅一个进行中。没有git/远程部署/生产迁移/收费推理授权，不伪称已上线。实际云账户信息未提供；用户选择由我们专业判断低成本方案，沿现有组合开发并提交可部署成果。DeepSeek harness发行物待用户可选回答。

初始安装baseline：exe SHA25673944f83e1cfbe6ebef12b2d57a23794cfa54eed4b9fe5eddcb4fef122250343，3.1.0。已有大量dirty文件，任何线程不得回滚/覆盖此前成果。所有dev使用独立port/dist，最终安装用户程序关闭才执行；不能强杀有未保存工作的用户程序。

正式开发窗口：
- Lattice 云端小组共享库与多格式工作区：01a11a38-2cf7-7902-81da-1b93fd443c57 / local。
- Lattice Agent 上下文与本地 Harness 接入：01a11a38-41f1-7a40-812f-087e348a2559 / local。

主窗口整合Goal已active；两个委托及计划文档检查141files通过。
