# Lattice 插件体系与公式识别：开发委托

## 本窗口 Goal
把 Lattice 插件从分散菜单/展示条目升级为真正可发现、可启用、可使用、可配置、可诊断、可停用卸载的工作流；专业借鉴 Obsidian 的插件生命周期与上下文命令体验，保持 Lattice 科研文档优势。深入复现并修复内置 formula-extractor，使公式识别、完整渲染、校正、来源定位及 Markdown/LaTeX 复制导出形成可靠闭环。交付真实实现、针对性测试与主窗口可整合接入方案，持续迭代到完成。

## 已知入口与必须先调查的问题
src/plugins/formula-extractor/{index,extractors,panel,export,types}.ts(x) 是现有插件；默认启用 ID 为 formula-extractor。src/lib/plugins/{runtime,types,registry,installer,repository,manifest,marketplace,worker-host,permission-catalog}.ts、src/stores/plugin-store.ts 和 src/components/ui/plugin-*.tsx 是现有机制。此前 PDF 批注已改善公式 glyph 结构恢复、跨列跨页与复制，相关 src/lib/pdf-formula-*.ts 和原文 PDF 阅读路径不能被新的平面文本启发式覆盖。公式 OCR 接口已有 pix2tex 路径，但是否有模型/环境、质量是否实际验证必须查证，不得假定可用。

用户反馈“完全用不了/效果极差”。先沿真实调用链复现：开启插件→上下文命令→读取 PDF/所选区域→结构抽取或 OCR→结果面板→来源定位→校正/复制→导出。检查作用域、失效选区、当前文件变化、误识别正文/页码、上下标/分式/矩阵被打散、缓存过期、重复扫描、权限状态、缺依赖、失败后 stuck busy 和卸载残留。给每个确认根因做对应修复，不能仅改错误文案。

## 插件体系必须落地
1. 用官方文档专业对标，区别“原生 Lattice 插件”和已有 Obsidian/VSCode 兼容能力，不承诺任意外部插件均能运行。完整 lifecycle、manifest/version/兼容性、启用/禁用/加载错误、重开持久化、卸载清理均可靠。
2. 设计一个清晰的插件中心：已安装/可用发现/详情与设置/权限/可执行入口/故障诊断。优先简化现有设置冗长内容，不在每个页面堆相同按钮。插件设置应可达且确实生效；状态来自 runtime 实际结果。没有真实来源的远程商城不做虚构数据。
3. 插件命令融合现有命令面板、文件/选区上下文、适当 toolbar/sidebar/panel。根据当前 viewer 与可用选区过滤或解释禁用原因；关键科研功能不要求用户在一长串不清楚菜单里猜。
4. 保留现有权限粒度与可信安装边界，能力不足给明确可恢复错误；启用失败不能误标 enabled。禁用/卸载释放 command、panel、事件、worker、styles、timer、document 引用；不会泄漏或阻塞主 UI。不能削弱文件写入审查与 workspace 约束。
5. 插件 UI 使用全局语义 CSS token，适配皮肤窗口的变量接口，不私自写入 globals.css 或硬编码皮肤。现有 ThemeAPI 问题可在 runtime 范围内修复，若需使用新 appearance 模块，先提出接口建议交给主窗口接入。
6. 更新开发者指南与一个可运行的最小插件示例，说明贡献点、设置、资源、生命周期与限制；测试插件包安装/权限/运行/停用/重新加载完整链路。

## 公式能力必须落地
1. PDF 原生 glyph/geometry 结构恢复优先，复用已有 pdf-formula-structure/selection/rules；DOM/textLayer 展示文本与原始 PDF glyph 不要混为一谈。对文本 PDF 的上下标、希腊字母、分式、积分求和、矩阵、双列和 equation numbering 建可比较 fixture。Markdown 显式 LaTeX、DOCX OMML/MathML 路径继续可用。
2. 正文、页码、引用序号不应大量误识别；置信/needsReview 必须体现实际证据，OCR 不能固定写 0.92 后假装已验证。无法确定结构时保留原始内容和来源，清楚指出待校正；不要编造公式。
3. 结果完整 KaTeX 渲染，提供 source preview/定位、可编辑 LaTeX、Markdown/LaTeX 复制、单条与批量导出；导出使用当前校正版本，不导出历史缓存。来源文档改变后的操作受绑定约束；复制和导出失败应可恢复。
4. 选区识别、当前页、全文扫描 scope 真正生效，支持进度/取消/重试。OCR 对扫描/图片公式为明确独立可用能力：检查后端依赖、展示状态与配置方式、处理超时/取消；不能把缺后端当成扫描零结果或让 OCR 崩溃影响其余功能。不要私自下载大模型/全局安装 Python 依赖/调用收费模型。对尚未实际运行的后端在报告中诚实列明边界。
5. 面板应让用户快速获得可用结果，避免各种扫描按钮排列成工具堆。支持阅读中从上下文直达，不重建一个重复 PDF 阅读器。

## 文件归属
你拥有 src/lib/plugins/**、src/plugins/**、src/stores/plugin-store.ts、src/hooks/use-plugin-shortcuts.ts、src/components/ui/plugin-*.tsx 及相关测试；可新增 src/components/settings/plugins-panel.tsx、plugin details/settings/diagnostics 模块与测试。可修 src/lib/formula-ocr.ts 和必要纯公式抽取逻辑，保留先前现有能力并跑回归。需要 PDF adapter/Rust 接入时，仅提交最小补丁给主窗口。settings-dialog 与 i18n 仅交接补丁；不要编辑另一窗口 settings-store/theme-selector/use-theme/globals/appearance 代码。

## 验收与收敛
测试必须含开启失败、停用再启用、重复加载无重复 command、卸载清理、权限拒绝、切文件后的过期结果、scope/取消/重试、clipboard/export failure。公式使用可人工核实的 fixture，记录误检/漏检和 LaTeX 结构差异，不能只断言输出非空。真实浏览器操作至少覆盖插件中心→开启→PDF/Markdown 识别→完整公式渲染→校正→复制导出→禁用；缺少 Rust 接入时用隔离 mock 验证并准确交接缺项，主窗口会做桌面最终验收。

官方参考起点：https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
https://help.obsidian.md/Extending%2BObsidian/Community%2Bplugins
https://docs.obsidian.md/community-directory/developer-policies
先重新查证所用 API/文档，不复制未知第三方插件执行架构。

计划：docs/superpowers/plans/2026-10-05-plugin-workflow-formula.md
设计规范：docs/superpowers/specs/2026-10-05-plugin-workflow-formula-design.md
交接：docs/tests/2026-10-05-plugin-workflow-formula-handoff.md
## 执行方式与协作约束

用户已明确授权直接设计、开发并持续迭代，要求两个开发窗口各自设置 Goal；你就是其中一个正式开发窗口。第一步调用 get_goal，若没有未完成目标，使用 create_goal 创建下述本窗口目标，不设置 token_budget。完成设计、实现、验证、交接后才可标记 complete；不能把“写完方案”“代码能编译”当作已完成。持续处理失败和审查意见；不要为了省事只交付建议。遵循用户已给出的方向，常规可逆设计决定自主落实，无须重复询问是否开始。

先读项目 AGENTS.md、.agents/skills/lattice-project-flow/SKILL.md 和相关技能，使用中文沟通。涉及 Next.js 时先读 node_modules/next/dist/docs 中对应版本指南；优先官方文档与 Context7。用任务板记录 pending/in_progress/completed；若无 update_plan 工具，则在本窗口独立计划文档中维护。同一时间一项 in_progress。

这两个新窗口使用同一 Lattice 项目目录，共享现有大量未提交开发成果。禁止 git 提交、push、创建分支、reset、清理或覆盖他人文件，禁止远程部署。不要创建更多任务窗口。仅修改下述本窗口归属文件；需要修改共享文件时写 integration patch 和准确接入说明交给主窗口，不能直接编辑。其他窗口可能正在修改不同文件，不得将其临时类型检查失败修成覆盖对方成果。不要重写整个仓库、全局格式化或更新核心依赖。

主窗口拥有 src/components/settings/settings-dialog.tsx、src/lib/i18n/zh-CN.ts、src/lib/i18n/en-US.ts、src/components/renderers/pdf-highlighter-adapter.tsx、src-tauri/src/main.rs、package.json、lockfile、发布脚本和桌面安装。你对这些文件只读。本窗口需要的接入改动放在独立 handoff 文档并提供最小补丁；组件内部可以暂用局部双语字典，但正式全局翻译的增量交给主窗口。两个窗口可读对方计划/交接文件，禁止擅自编辑对方归属文件。直接整合的必要 UI 入口须在本窗口 handoff 说明清楚。

本窗口只运行相关测试、针对性 lint 和必要类型检查；不要执行全量 qa:gate、Next 生产构建、Tauri 打包或安装，避免并行构建互相覆盖。完整集成门禁、安装和最终产品更新由主窗口执行。浏览器调试使用独立端口，不复用或关闭别人的服务。测试使用合成文档、隔离存储和本地 mock；不要读取、修改或打印用户真实密钥，不要调用用户配置的模型接口/收费 API，不上传个人论文。旧“最多三次接口测试”授权不可复用。

交付必须包含：实际修改文件清单、行为变化、官方参考与设计依据、测试命令与真实结果、浏览器截图/互动验证、仍存在的边界、共享文件接入补丁。写入本窗口独立 handoff 文档；主窗口会读取你的任务进度并发送整合审查意见。不要猜测主窗口 ID。完成后保持可继续响应，主窗口不会只因你自称完成就跳过审查。

