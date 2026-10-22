# Lattice 皮肤与插件集成交付验收

本报告由主窗口维护，源码、测试输出、渲染页面和实际安装为验收依据。开发窗口的成功陈述不能代替完整范围验证。桌面基线为 3.0.0 / SHA256 46df690023fccc218dd5528c3b360c155cb398c59c43bd853fef5537d64ea5b7。

**最终交付：已于 2026-10-05 更新本机 Lattice 3.1.0。** 安装路径 `C:/Users/XINGLUOYUNSHEN/AppData/Local/Lattice/lattice.exe`；已安装、已验收和发行包 exe 的 SHA256 均为 `73944f83e1cfbe6ebef12b2d57a23794cfa54eed4b9fe5eddcb4fef122250343`。原桌面快捷方式目标正确。旧 exe 备份在 `releases/v3.0.0-before-skins-plugins-20261005-213852/`，旧完整安装包仍保留。新版交付目录为 `releases/v3.1.0-skins-plugins-20261005/`。

完整 Gate：442 files / 3687 tests、Next/Rust/MSI/NSIS 全通过，1249源码文件冻结无变化。最终原生交互、真实插件包和文件导出，以及已安装产品的冷启动、自定义皮肤导入保存和全新进程恢复均通过。以下工作记录保留各轮失败与修复事实；早期“待完成”描述为历史状态，以本节和当前矩阵为准。

| 明示范围 | 当前状态 | 证据或待验证内容 |
| --- | --- | --- |
| 两个正式窗口与独立 Goal | completed | 皮肤 01a10b03-b66d-74e3-97b9-9018f70c4b93；插件 01a10b04-45ed-7421-86ee-97e45508eaca；均已核实 Goal complete、交接并冻结源码 |
| 五套专业皮肤，每套浅深色、七类产品面 | completed | 10组合×7页面70无force截图；最终原生五皮肤通过；已安装版冷应用早于firstPaint |
| 自定义、安全 JSON、预览取消、持久化与 AI 设计交换 | completed | 校验/损坏草稿/失败回滚/并发/FIFO/取消已测试；已安装产品真实JSON导入→保存→新进程恢复通过 |
| 插件中心替代旧重复入口 | completed | settings-dialog 已接入 PluginsPanel，删除约 880 行旧管理逻辑；设置测试 13/13 |
| 安装/可信授权/设置/命令/停用卸载完整流程 | completed | 同 ID 更新撤销旧授权；最终桌面 ZIP/授权/真实Worker/audit/资源图像/卸载全部通过 |
| 生命周期失败回滚/清理与重复加载 | completed（实现与测试） | 激活/停用失败、跨插件隔离、资源完整回滚、legacy 迁移与 pending marker 分支已测试 |
| 公式原生结构恢复、scope、取消、校正与来源绑定 | completed | 真实glyph/drawing透传、PDF三公式精确比较；scope/stale单测；最终原生校正/复制/导出通过 |
| 复制/导出正确且失败可恢复 | completed（原生路径） | 真正 OPFS 文件句柄写入/close/读回 .md/.tex；校正 x³、matrix、E=mc²逐条正确；picker 选址脚本化，OS保存对话框未测 |
| OCR 后端边界 | completed | PATH/bundled Python无pix2tex；原生命令不可用在139ms明确返回；无执行探测单测通过；未使用收费API |
| 原有 PDF/AI/文件编辑回归 | completed | 最终binary三点菜单八操作、跨列/跨页/滚动六方向、公式、AI文件执行和全新进程配置恢复通过 |
| 完整 qa:gate 与源代码冻结 | completed | 第五轮 exit0；442files/3687tests、Next/Rust/MSI/NSIS全通过；1249冻结文件未改 |
| 发行包与本机桌面更新、安装后启动 | completed | canonical packager verified；静默安装exit0；已安装版号/hash/快捷方式/冷启动/插件运行/自定义皮肤新进程恢复通过 |

## 主窗口已验证

- 原有设置基线：8 tests passed。
- 增加激活失败状态回归：旧实现显示 active1，期望 active0，已确认失败；修复为 runtime health 后 10 tests passed。
- 增加插件中心接入回归：旧实现不能找到独立中心，确认失败；接入后 11 tests passed。
- 共享设置入口 lint 无错误；已清除本次产生的 unused 警告，保留既有 effect 警告。

- 下载提示阻挡引导/工作弹窗两项回归：先确认失败，修改后与设置共 2 files / 16 tests passed。产品 shell 根据引导完成和打开的工作对话框抑制推广提示，避免叠层。移除没有现行测量依据的 6 MB/3x/50% 宣称。
- IAB 已加载独立 127.0.0.1:3528，390×844 真实渲染确认：设置导航横向滚动、插件中心可达、代码兼容文本不再被操作按钮压成竖列。控制台无相关错误；IAB 点击在溢出导航有命中偏差，键盘 Enter 验证通过，最终桌面仍需鼠标验证。
- 原生公式生产数据审查发现 segment 强制类型转换不能产生 fontSize/baseline，原结构恢复分支不会被真实 PDF 执行；已要求插件窗口在自己 runtime 数据路径构造原始 kernel bridge。皮肤预览/持久化目前也有快照 dark class、FIFO poison、hydrate 全量覆盖风险，已发回原窗口处理。

- 主窗口生成真实 PDF 验收源：`public/__lattice-diagnostics/plugin-formulas.pdf`，三页包含向量分式横线、上标和双列矩阵；第三页无公式。生成脚本与逐条预期位于 `tmp/pdfs/`，已用 pdftoppm 渲染并通过 view_image 检查第一页面。插件窗口需把生产数据路径输出与这些预期比较；结果图像不等同于 OCR 正确性。
- 插件结果转移回调 `onOpenResult={onClose}` 与指南入口已接入共享设置，避免生成结果面板被设置 overlay 遮挡。
- 2026-10-05 当前独立验收服务 `127.0.0.1:3528` / `.lattice-build/integration-dev`，主窗口 session 68795，PID 14396。两个开发窗口仍有 active Goal，尚未启动完整构建或安装。

- 主窗口已新增 `/diagnostics/skins-plugins`：完整 AppLayout 加合成 OPFS 工作区、实际 PDF、公式 Markdown、代码、Notebook。IAB 确认 PDF 原文和文件导航加载成功。两个开发窗口可在各自独立服务复用，避免个人资料或真实 API。
- 主窗口检查 OCR 环境：PATH 未找到 pix2tex，bundled Python 的 `find_spec('pix2tex')` 返回 false。普通原生 PDF 结构恢复必须独立可用；OCR 后端不可用需产品给明确状态。复用既有 native probe_command_availability，避免新建重复机制或触发模型下载。
- 发布 source freeze harness `tmp/qa/skins-plugins-release.cjs` 已准备并经 `node --check` 验证；冻结范围含 CSS、全部 src/scripts/public 和依赖/Native 配置，避免旧快照遗漏皮肤 CSS。尚未执行 qa:gate。

- 主窗口独立复跑真实 PDF 与原有结构/rules 回归：`npx vitest run src/plugins/formula-extractor/__tests__/real-pdf.test.ts src/lib/__tests__/pdf-formula-structure.test.ts src/lib/__tests__/pdf-formula-rules.test.ts --maxWorkers=1`，3 files / 30 tests passed，4.72 秒。逐条精确比较 x²=a/b、2×2 matrix、E=mc²，第三页零公式；此证据证明 production geometry helper + extractor，runtime 的三种 scope 接入和用户交互仍待检查。
- 主窗口共享设置/弹窗再次复跑 2 files / 16 tests passed，10.38 秒。验收 diagnostics 新文件 lint 通过。
- 皮肤窗口正在替换 AppearanceEditor，当前共享开发页短暂出现 module-not-found；尚未冻结源代码，不用于发布判定。待归属窗口恢复模块并完成验证，再续浏览器验收。

- RootLayout 已接入 `APPEARANCE_BOOTSTRAP_SCRIPT`，head 先执行受限外观缓存应用，html 仅为预绘制属性变更设置 suppressHydrationWarning；不读取 AI 配置。缓存变量类型及对比度验证由皮肤窗口继续完善。
- 新增原生 OCR 探测可选 `includeVersion:false`：只解析可执行路径，不启动模型；缺省仍保留运行器原有版本探测。使用真实 synthetic-ocr.cmd 写标记的单测已通过，确认 path-only 没有标记、默认版本探测产生标记。原生命令 test 1 passed / 0 failed；已先确认新参数未实现时编译失败。直接本地可执行路径支持避免 Windows where 对绝对目录格式拒绝的问题。
- 合成验收页改用正式 applyWorkspaceHandleToStores 注册身份/文件树/最近工作区，热更新清空状态时可通过 Reload synthetic acceptance materials 恢复；这个入口只存在于诊断 route，普通产品界面不增加测试按钮。

- 真实 IAB settings→Details→Extract formulas 确认命令执行后无可见结果。根因：ctx.ui.openPanel 只写 durable flag，AppLayout 仅启动读取；另本地 persist effect 会将外部 true 写回 false。主窗口补即时事件监听并将持久化限定为本地可见状态变化，插件窗口补 durable 写入成功后的 event/权限/所有权检查。两项回归先红后绿，AppLayout 全 4 tests passed（2.71 秒）。修正测试从动态组件 mock 断言改为实际面板按钮 ARIA 状态，避免误把 mock 渲染缺项当产品故障。真实链路继续复查中。

- 主窗口真实 IAB 复查结果已自动打开，全文三公式渲染正确。第一条改为 x³=a/b，真实 browser-session clipboard 读回 LaTeX `x^{3}=\\frac{a}{b}` 和 Markdown `$$x^{3}=\\frac{a}{b}$$`。未读取原用户剪贴板，先写入合成 sentinel 后才测试/读回。
- 实际 `.md` 导出失败：showSaveFilePicker 的 accept MIME 使用 `text/plain;charset=utf-8`，浏览器报 Invalid type；已向插件窗口提交具体调用栈与复现，让其修正规范化和参数回归。不能用 ctx.exportFile mock 的通过声明真实文件导出成功。

文件选择器参数依据：[MDN showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)，accept 映射需要可解析的 MIME 类型及合法扩展名，非法值抛 TypeError；实际错误证据来自上述页面操作。

- 主窗口独立主题回归 5 files / 35 tests passed（13.15 秒），覆盖 runtime/缓存/编辑器/持久化；后续新改动仍需发布前复跑。
- 设置原 Escape 无效已确认测试失败；添加最上层 modal Escape 与 dialog ARIA 语义后，设置测试 13/13通过，包含不关闭另一 modal 下的 Settings（6.01 秒）。shared lint 无错误。
- 安装同 ID 替换的信任继承问题已从 store/registry 生产路径确认并交插件窗口修复：替换包不能自动继承旧 enabled/trusted；授权变更必须检查 generic settings API 的 false 返回值，不能只等待 Promise。此项属插件生命周期和明确安装授权验收，尚未通过。

- root IAB computedStyle 确认字体 token 作用域故障：html 的 `--font-geist-sans` 与 `--appearance-font-ui` 空值，而 body 的 Geist 变量有效。RootLayout 已将打包字体变量 class 移至 html，body 仅保留 antialiased，修后继续实测根变量与工作区字体。主题矩阵须包含字体规则真实生效，不能只以 palette 变化确认多风格。

- root 冷加载复测已确认修复：html GeistSans 变量有效，appearance-font-ui 实际为 GeistSans 字体栈，appearance-font-code 实际为 GeistMono 字体栈。不能继续以修前空值视为当前问题。
- 视觉矩阵的 HMR 干扰已定位：两窗口虽独立 port/dist，但共享 src，插件 runtime/store 改动会重载皮肤测试页面。主窗口协调一次短暂可编译源代码只读窗口，让皮肤矩阵串行跑完；其间插件窗口继续 tests/docs，目标均保持 active。

- 首轮矩阵记录 70 截图、10 组合、无未捕获 pageerror；因脚本 force 与 Next overlay，不能当完整合格证据。无 force 重跑暴露 Console Error overlay。
- 冷页进一步定位 SSR 500：integration-dev 旧 chunk loader 缓存曾经的重复 result 语法失败，当前生成文件 node --check 已通过。主窗口仅停止自己创建的 Next PID14396/port3528，保留旧目录，用新的 integration-cold-20261005 编译目录启动（session98633）。不是因观察超时重启。插件源码只读协调窗口已结束并明确通知恢复，其继续同 ID 替换与导出回归。
- RootLayout 统一使用当前 Next 官方 Script beforeInteractive，并在执行后记录本地 performance mark，后续以冷页面 console 和 applied/firstPaint 时序实证；原生 inline head 方案不再作为最终交接。

- 新缓存 cold smoke 已通过：Next Script 置 body，beforeInteractive；真实 Apply Nocturne dark→reload 后 theme/mode 保留；applied=125.5ms，firstPaint=128ms；consoleErrors=[]，dialogErrors=[]。只有 expected OPFS missing override fallback warning。证据 `output/skins-plugins-release/appearance-cold-check.json`，临时验收脚本 `tmp/qa/appearance-cold-check.cjs`。旧 raw-script React错误与Server500已不在该运行出现。

- root 已读取新版无 force/dismiss matrix：70 rows / 10 theme-mode组合，包含 settings/pdf/markdown/code/notebook/ai/plugins，pageErrors=[]，persist与narrow=true；现有matrix尚无console字段，不扩大此证据范围。另cold smoke提供独立0consoleErrors。已用view_image审查Folio阅读、Atelier代码、Nocturne设置与窄窗口截图，确认实际界面可读且有风格差异。
- 插件包写失败的旧授权恢复仍有事务风险，已发回归属窗口：repo多文件顺序写/fallback不能证明未改变原包，开始写入后的失败须保持禁用未信任或实证原子回滚，不能盲目恢复旧授权。
- 外观草稿的无效对比度预览也需保证编辑器可用，已要求保留上个有效预览和可编辑错误草稿；有效内置70矩阵不会因此重复扩大测试，仅补该用户交互回归。

- 主窗口独立包/store/resources/export/reveal回归已跑 4 files / 10 tests passed（6.68 秒）；插件窗口最新已加入资源树完整回滚与marker保护，新增故障路径仍待最终复跑。
- UI窗口已交付38tests/6editor tests并停止产品src编辑；此前无效草稿验证在preview内已存在，本次用明确入口与行为回归加强契约，不把过时源码理解视为新增缺陷。
- repo新增marker直接拒绝旧无marker目录会让现存OPFS插件升级后不可见，已要求完整legacy格式的安全迁移、明确pending中断标记区分，以及commit id/version一致性验证；这是发布兼容性收尾，不能跳过。

- 两开发窗口已最终交接并停止源码修改：主题38tests/70真实截图；插件15files/80tests，源码TypeScript/lint与legacy/pending/资源故障路径通过。本机原有Lattice进程当前已关闭，安装前仍会重新检查。
- 版本已统一3.1.0（package/lock/Tauri/Cargo/lock），依赖版本不变。第一轮Gate的四项发行测试硬编码3.0.0，已确认失败并保留attempt1日志；停止已确认owned QA进程后修为当前版本变量，4/4独立通过，保留误匹配版本/坏PE/输出目录保护检查。
- 第二轮完整Gate已启动：session74158，owned QA root PID30796，冻结1249文件；lint0errors、typecheck、docs138通过，当前全量Vitest仍在执行（测试worker持续更换，非仅锁文件证明）。源码未改，尚未完成build/Tauri/打包/安装。
- Native验收脚本已准备：tmp/qa/native-release-check.cjs复用已验证旧PDF菜单/跨列跨页/公式/AI设置与文件审查案例，另tmp/qa/skins-plugins-native.cjs检查新皮肤与真实PDF公式校正复制。只有当前完整Gate成功且sourceUnchanged后才运行。

- 第二轮Gate已终止并保存attempt2证据：442 test files / 3685 tests全通过；Next生产编译30.5秒成功；随后Next TypeScript阶段对next-env.d.ts open报UNKNOWN，gate exit1、sourceUnchanged=true。文件存在且Node r+读取/写入权限探测已通过（未改字节），3217/3417/3528开发服务当前都已停止；不臆测具体OS锁持有者。下一阶段先复测构建错误，再以完整fresh Gate通过后继续Native打包。

- 独立 `npm run build` 复测已 exit0：TypeScript 34.1秒、19静态页生成成功。没有源码修改；next-env.d.ts已由Next自动生成生产类型引用。重新启动第三轮canonical qa:gate，以完整成功结果作为发布依据，不把旧失败gate和单独build拼成已完成门禁。

- 第三轮 Gate exit1 / sourceUnchanged=true：441 files / 3684 tests passed，单项 bridge-resource action 请求在到达服务器前报 `fetch failed`，cause `bad port`。独立六用例均通过。根因是 OS 分配的随机本地端口触发 Fetch 端口阻止策略；原生产品的 Rust reqwest 桥接不经过浏览器 Fetch。测试请求改为 Node http.request，鉴权、路径隔离、白名单断言全部保留；独立 6/6 再次通过。依据 [Fetch port blocking](https://fetch.spec.whatwg.org/#port-blocking)、[Node HTTP request](https://nodejs.org/api/http.html#httprequestoptions-callback)。已保存 attempt3 日志与结果；第四轮 canonical Gate 于 12:23:34 UTC 启动（session41391 / owned root28544），冻结1249文件。
- 最终原生验收脚本增加实际 OPFS 文件句柄导出（真实 Blob 写入/close/读回；仅 picker 选址脚本化，不宣称验证 OS 保存对话框）、文档样例 ZIP 安装/授权/真实 Worker/资源图片加载/卸载。验收运行前仍需要完整 Gate 成功及源码哈希一致。
- 第四轮 canonical Gate 已通过：2026-10-05 12:23:34–12:51:03 UTC，exit0 / sourceUnchanged=true / changedFiles=[] / frozenFiles=1249。442 test files / 3685 tests 全通过；Next 生产构建通过，Rust release 编译通过，MSI 与 NSIS 两个 bundle 成功生成。Lint 为0errors/174warnings（含既有代码和临时验证脚本），Rust 为2条既有 unused 函数警告，不宣称零警告。开始对最终 binary 执行隔离 profile 原生验收，桌面安装仍未更新。
- 原生第三次验收已确认 .md/.tex 真正文件提交与校正版读回，样例 ZIP 安装/信任/启用、真实 Worker 命令及 audit、Markdown 资源读取全部通过。但样例图片为 broken：MarkdownRenderer 的 defaultUrlTransform 会移除 blob URL。不能降低图片断言作为通过。主窗口修正为受限 isImageUrlAllowed（只对 img src 生效）；插件 host 根据 panel 所属 plugin、live asset URL 和 image MIME 精确授权；dock/dialog 均传同一契约，卸载后失效。新 renderer 回归先失败（Own image src=null），修后与 ownership/cross-plugin/non-image/revocation tests共2files/20tests通过。依据 [react-markdown defaultUrlTransform](https://github.com/remarkjs/react-markdown/blob/main/_autodocs/api-reference/default-url-transform.md)。旧原生失败日志保留，产品源码修复意味着旧 Gate 不能作为最终发布，待第五轮 full Gate 与新 native 验收。
- 前两次导出原生验收的空文件断言是临时脚本竞态：已检查本地 Playwright frames.js，waitForFunction 同步判断 predicate 返回值，async predicate Promise立即truthy。改为逐次 await 真实文件读取再断言；导出器无需源码修改。第三轮 actual exported-formulas.md/.tex 有完整校正公式，截图已由主窗口审查。
- 图片修复 TypeScript 和产品归属 ESLint 通过；ESLint 跳过测试文件产生两条提示，不能把它们当已lint测试。修复文件独立 diff-check 无空白错误。全工作区 diff-check 显示其他历史 universal-annotation-sidebar.tsx 一处空白，主窗口未改其既有成果。第五轮 full Gate 于 13:10:20 UTC 启动（session90441 / owned root1532），仍冻结1249文件。
- 两正式窗口再次核实各自 Goal complete，没有 active Goal、新服务或源码改动；最终桌面交付属于主窗口仍 active 的整合 Goal。第五轮 Vitest已442files/3687tests全通过；Next生产前端编译通过，桌面打包继续。
- 第五轮最终 canonical Gate 已通过：13:10:20–13:34:04 UTC，exit0 / sourceUnchanged=true / changedFiles=[] / frozenFiles1249；442 files / 3687 tests，Next生产编译、Rust release、MSI和NSIS均成功。开始第四次原生验收，必须确认 packaged image 的新分支在最终二进制上通过，不能以之前3685测试构建为安装目标。
- 最终原生验收已 exit0：菜单八项操作、结构公式、跨列/跨页/滚动共六方向选择、公式校正复制与真实文件导出、五主题、ZIP安装/授权/Worker命令/audit/Markdown与SVG资源/卸载、AI配置恢复与文件执行、全新进程重开全部通过。pageErrors=[]；未验证Windows OS剪贴板读回，原生复制记录真实API fulfilled及payload，浏览器另有真实session读回。原生二进制 SHA256 `73944f83e1cfbe6ebef12b2d57a23794cfa54eed4b9fe5eddcb4fef122250343`。
- canonical packager `--skip-qa --artifacts-dir src-tauri/target/release --output-dir releases/v3.1.0-skins-plugins-20261005` 已 exit0 / verified，未重跑构建。MSI289863461bytes、NSIS202768712bytes、exe19059200bytes，三产物版本与checksum已核对。新旧安装检查再次确认原产品无进程、版本3.0.0与原hash一致；开始静默本机更新，不触碰用户配置和文档。
- 本机静默安装 exit0，旧版本3.0.0备份已核对，安装exe hash与上述最终验收一致；桌面快捷方式仍指向本机安装目录。实际已安装exe冷启动验证3.1.0、Nocturne dark缓存恢复、公式插件active、pageErrors=[]。追加自定义主题JSON真实导入/保存，退出并重新启动同一隔离profile进程，custom id及名称保留且恢复dark。最新内置应用97.3ms/firstPaint104ms，自定义新进程应用289.5ms/firstPaint308ms。证据 `output/skins-plugins-release/installed/result.json`，正式验收没有读取用户API配置或个人文档。

## 收敛约束

两个开发窗口已完成并只读；主窗口已完成整合、门禁、原生验收与安装。既有未提交成果保留，没有Git提交、推送、分支操作或远程部署。真实用户API/密钥/个人论文未用于本轮测试。OCR实际模型质量、真实服务商可用性、任意Obsidian/VSCode插件兼容、Windows保存对话框及OS剪贴板读回不在已验证结论内；文件导出通过真实OPFS句柄写入/close/读回，选择器选址为脚本化。
