# 云端库与Agent整合验收（开发中）

用户授权两个独立开发窗口，低成本优先，交付版本保持3.1.0。主窗口Goal active，产品尚未更新。

| 范围 | 状态 | 验收依据 |
| --- | --- | --- |
| 两正式窗口与Goal | completed | 01a11a38-2cf7-7902-81da-1b93fd443c57云库；01a11a38-41f1-7a40-812f-087e348a2559 AI；均已active开发 |
| 云库连接/多格式/队列/权限 | in_progress | 原默认local_only、RemoteContent拒绝保存、sync push只写log；归属窗口补真实链路 |
| Agent会话/长输入/索引/复制/技能/事件 | in_progress | 普通draft无持久入口、activeID默认第一条、source8文件上限、复制失败静默；归属窗口复现修复 |
| 官方Native harness | in_progress | Codex0.162.0-alpha.2 schema真实检查；Claude未检测；协议与安全字段须匹配本机版本 |
| Windows登录存储 | completed（focused） | 原secure命令明文已确认；DPAPI用户级envelope、key entropy绑定及成功存储才迁移；新Native回归先红后绿4/4 |
| 共享入口/权限与版本provider | in_progress | AppLayout保留本地workspacetabs，Cloud组件嵌入；AI消费真实权限/版本接口，不伪造FS路径 |
| fullGate/原生/发行/安装 | pending | 两窗口完成并冻结后主窗口独占执行 |

## 已核对事实

- 2026-10-08初始本机exe为3.1.0，sha25673944f83e1cfbe6ebef12b2d57a23794cfa54eed4b9fe5eddcb4fef122250343。大量未提交成果保留。
- 用户选择低成本优先；沿现有Supabase/R2组合，无账户创建/生产迁移/远程部署或真实收费AI/harness推理。当前真实推理数0。
- 桌面secure_get/set/remove目前源码原行为是shared-library.json明文String。主窗口新增shared_library_secrets.rs，使用用户级DPAPI不使用LOCAL_MACHINE，按storage key绑定entropy，只接受version1严格envelope；损坏值不可当plaintext。旧String只在保护和store.save成功后迁移；失败恢复先前内存value；remove失败也恢复。non-Windows没有明文降级，不支持该OS安全后端时明确报错。
- Native DPAPI回归最初2fail/2pass，实际实现后4/4pass：原文不出现在serialize、同keyUTF8往返、不同key拒解、未知/损坏版本拒绝、非法key/128KiB超限拒绝。测试只用合成值，未读取用户凭据。主程序focused compile/test完成。
- 官方依据：[CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)、[CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata)。不扩大为API密钥或所有appsettings已加密，本轮仅云端安全存储命令。
- Cloud窗口已核实Docker daemon未运行，不启动系统服务。真实本地HTTP验证与尚未执行的Postgres RLS必须分开记录。

## 交付约束

主窗口独占共享入口、Native main、依赖/版本和发布。各窗口声明实现或测试成功不代替交叉验收。云配置未提供不代表可以使用假登录团队冒充生产；先完成客户端/后端/部署准备和隔离真实协议，再据实说明上线所需操作。

## 交接前主窗口证据（非发布完成声明）

- `npm run typecheck` 最新 exit 0；仍需在两窗口冻结后重新执行全量门禁。
- 主工作区/CommandBar/MainArea/Cloud host focused：4 files、28 tests 通过。
- `use-shared-annotation-system` 与 Cloud host focused：2 files、8 tests 通过。共享模式已接入 PDF renderer，本地 binding/sidecar load 被 defer，但还需真实云 PDF 写入/重开验收。
- PDF adapter 原有回归：1 file、158 tests 通过；这是既有行为证据，不代替新增共享模式专门验收。
- `src/app/diagnostics/agent-context-harness/page.tsx` 已创建，供 AI 窗口独立 3539 浏览器验收。诊断 provider 和 harness transport 明确为 fixture，不是真实模型推理。
- `main.rs` 已注册 11 个 harness 命令，包含 `tool_result` 与 `read_scratch`；注册事实不等同原生运行通过。
- 主窗口新增真实 Cloud reader navigator。AI 窗口已接 provider.read 校验后打开；云端 anchor 曾采用 0ms 事件，存在新标签未挂载漏事件与 line/cell/snippet 未定位的问题，保持未完成，交接后必须收敛。
- 2026-10-08 22:48（本地）两个线程仍活跃。AI 浏览器已找到 PDF 子文件请求被读文路径截获而未生成 Review 的缺口，归属窗口继续修；云窗口继续 PDF/账号隔离/断网/导航定位实证。主窗口不运行发布或安装。
