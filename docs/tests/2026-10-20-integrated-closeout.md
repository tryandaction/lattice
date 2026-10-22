# 2026-10-20 整合验收与交付

> 当前最后交付以 [3.1.0 当前交付状态](2026-10-20-final-delivery.md) 为准。本文保留首个候选 `74e24443…` 和worker修复候选 `3dd46937…` 的前后对照，不作为最后文案修复构建 `59c081f8…` 的重复耐久验收。

## 本轮改动

- 工作区 watcher 遇到展开目录一次瞬时读取失败时，等待 100ms 后只重试一次，避免在原生监听关闭备用轮询后长时间保留旧分支。
- 插件设置、公式插件命令/权限、OCR 标签、英文主题颜色名/显示规则、克隆默认名和主题导入校验消息补齐本地化。第三方作者提供的名称保持原样。
- AI/Agent、PDF、云协作、插件/外观和文件交互分别按当前工作树复核，报告位于 `.lattice-build/turn-20261020/`；历史窗口完成状态没有作为全产品验收结论。

## 完整质量门

`npm run qa:gate` 完整退出 0，包括：

- ESLint：0 错误、200 条警告；不将警告说成已经清零。
- TypeScript 检查通过；184 份文档检查通过。
- Vitest：543 个测试文件通过、2 个跳过；4,783 项测试通过、2 项跳过。
- Next.js 16.3.4 静态生产构建通过。
- Tauri/Rust release 编译、MSI 和 NSIS 安装包构建通过；Rust 有 4 条未使用代码警告。

专项结果：AI 202 项及继续意图浏览器 2 项、原生 Harness 46 项；PDF 359 项及跨页/双栏 10 项；云端 77 项及 45 项合成 RLS 检查；插件/外观 59 项；文件交互 84 项。它们覆盖各自范围，不与全量用例数相加作为唯一质量指标。

## 6000 文件桌面耐久

正式候选 SHA256：`74e24443ad7cb6b37f70c7b083ab20831529bba03c840c9a82e330c7e1ed56f1`。

仅使用 `.lattice-build` 合成工作区及独立诊断设置，运行 901,099ms、380 轮，13 次批注落盘并在结尾恢复；无 page/console 错误、无模型请求。

| 操作 | 次数 | p95 | 最大值 |
| --- | ---: | ---: | ---: |
| 外部文本刷新 | 380 | 828ms | 870ms |
| 外部新增 | 127 | 975ms | 992ms |
| 外部删除 | 127 | 861ms | 895ms |
| 外部改名 | 127 | 406ms | 931ms |
| 切换文本 | 343 | 288ms | 498ms |
| 切换 PDF | 40 | 643ms | 683ms |
| 输入及保存 | 76 | 128ms | 147ms |
| 创建批注 | 13 | 1,137ms | 1,137ms |

JS 强制回收采样首尾约 29.8/37.1MB，DOM 首尾 1245/1249，document 始终 2，监听器首尾 720/781。Tauri/WebView2 进程组工作集首值约 1.07GB、末值 1.48GB、峰值 1.73GB，回归斜率约 40MB/分钟；其中同一 WebView2 进程从约 243MiB 增至 832MiB，不能用 JS 堆稳定证明原生内存无问题。交互阈值通过，资源增长原因仍需定位，不宣称全部性能已收敛。

机器证据：`.lattice-build/native-endurance-final-20261020-finalcandidate/result.json`。早期欢迎页配置、虚拟滚动定位和节点重挂载的脚本失败保留在各 `native-endurance-preflight-20261020*` 目录。一次旧构建运行在约 237 秒时文件栏收起并报告最小化 ACL 错误，原因未证实；随后有 UI 轨迹的 5 分钟诊断和本次 15 分钟正式候选未重现，不能把失败记录删除或解释成已修复。

## 安装与 PDF/设置恢复

交付目录：`releases/v3.1.0-final-closeout-20261020/`；正式脚本验证主程序 ProductVersion 为 3.1.0。

| 工件 | SHA256 |
| --- | --- |
| 主程序 | `74e24443ad7cb6b37f70c7b083ab20831529bba03c840c9a82e330c7e1ed56f1` |
| NSIS | `f8892a984692e5bb156ba9fd18b8d059d410ae141a4f204c623d671cb9cbdd78` |
| MSI | `4b4322bc64dc8ac8a4589d98ae7f11b03a7a8f9138c427636ad9d5ed7112174c` |

正常关闭旧桌面进程，NSIS 静默安装退出 0。安装后 `%LOCALAPPDATA%/Lattice/lattice.exe` 与工件哈希一致。用户 `settings.json` 安装前后 SHA256 一致；AI 凭据文件关闭时重新排序落盘，但比较 7 个键和值完全一致，未输出凭据值。设置和凭据备份保留在 `.lattice-build/install-backup-20261020-final/`，该目录不属于交付包。

安装版随后用独立诊断配置与合成 PDF 通过十阶段回归：打开 PDF、原三点菜单编辑/保存、创建子文件、重开恢复、语言/皮肤/深色模式恢复、父根→子根→父根、外部改名、相同字节独立副本隔离、移动后新根恢复；pageErrors=[]，模型请求 0。机器记录为 `.lattice-build/desktop-safe-closeout-native-20261019/result.json`（checkedAt `2026-10-20T05:31:23.294Z`，profile `quality20261017-1792474207820`）。没有启动用户普通配置以自动打开私人研究目录。

## 网页部署

同次门禁静态构建已部署到 Cloudflare Pages `main`，部署成功：`https://f8866c2d.lattice-apq-7xj.pages.dev`。首页 SHA256 为 `63286866453c03d11c93f2c02943937fb8472cdda3979ac2c17c5ea903ccd992`，构建时间 `2026-10-20T04:32:17.619Z`。未独立抓取生产页面，不把 CLI 部署确认扩展成所有线上交互验收。

## 仍未闭环

- 真实模型最终回答由用户体验；没有新增 API/CLI 推理调用，历史空答/截断失败没有被离线 fixture 改成成功。Claude 上游配置按用户要求暂缓。
- WebView2 资源增长需继续观察。Windows 资源管理器真实拖入和完整系统剪贴板公式拖选未验收；当前 native computer control 禁用，不能以合成事件冒充。
- 图像公式 OCR 已用隔离配置首次安装固定的278MB运行时，并完成本地合成图片识别：6类均返回LaTeX，但精确匹配仅1/6（分式正确；根号把x误为alpha；积分格式不同；矩阵结构错；上下标语义正确但格式不同；多行改写为array）。证据 `.lattice-build/desktop-managed-ocr-final-20261020c/result.json`；未测试在线重新下载，网页图片OCR仍desktop-only。
- 云库产品路径已有部署及 RLS 证据，但长期监控身份、通知渠道、供应商费用告警权限、独立加密备份介质/密钥托管、全项目导出与恢复项目/窗口尚未落实。没有访问或修改生产数据，没有把本地演练说成生产运维上线。
- 公开安装包分发和旧域 `lattice-apq.pages.dev` 控制权仍未落实；没有提交或推送仓库，也没有自动创建发布标签。

## 追加 PDF Worker 生命周期修复与最终更新

后续诊断证实 `loadPdfJsDocument` 显式创建并传入 `PDFWorker`，而 PDF.js 5.4.296 只销毁自己内部创建的 worker。组件虽然调用了文档 `destroy()`，外部 worker 仍存活。旧候选120秒合成切换实际目标计数从1增至7（短诊断因继承的采样数断言失败，不视作完整性能通过）。

当前源码在返回文档上绑定幂等销毁承诺，先等待原文档传输层清理，再在 `finally` 销毁显式 worker；加载失败清理也等待任务销毁，且保留原始错误。6项生命周期用例、5个相关文件190项通过，类型检查和源码ESLint通过。详见 `.lattice-build/turn-20261020/memory-growth-audit.md`。

追加修复的完整 `npm run qa:gate` 最终退出 0：全量 545 文件中 543 通过、2 跳过；4,785 项测试通过、2 跳过；lint 0错误、200警告；类型、文档、Next build、Tauri release、MSI/NSIS 均完成。首次全量重跑曾有一次 Vitest fork 启动超时，单测4项通过，完整重跑退出0；首个失败日志另行保留。最终日志 `.lattice-build/turn-20261020/qa-worker-closeout-final.log`。

旧候选的真实worker target计数在120秒、51轮中从1增加到7；它的15分钟 renderer 工作集243→832MiB、峰值961MiB。Worker 修复后：60秒安装前对照检查3次、PDF target数量全程0；最终安装版15分钟/900,872ms、384轮、41次PDF切换，55个采样中的PDF worker target全部为0，切到文本后39次检查均为0，没有worker累积。文件刷新p95 832ms，创建943ms、删除857ms、改名385ms、文本切换199ms、PDF切换483ms、保存94ms；13次批注持久化，page/console错误0。JS堆 forced-GC采样首尾约30.2/35.3MiB、峰值67MiB；renderer进程工作集232→497MiB、峰值635MiB，进程组约1.01→1.23GiB、峰值1.42GiB。另做同一安装版60秒活动+120秒静置/GC：renderer私有内存从活动峰值约297MiB回落到213MiB，之后120秒稳定；V8总堆从约98MiB回落至35MiB后稳定；PDF worker始终为0。这更符合可回收分配高水位，仍不据此保证所有Chromium/GPU缓存均回收。

最终候选 `releases/v3.1.0-final-worker-fix-20261020/`：主程序 SHA256 `3dd469373889ae167d26d89912baab14d0a54f396085f52676a5728c58efcefb`，NSIS `6889ecaa21d4f7fc1a34325cfd97152fe1b6023d17ab341bdc62a3a57143c2ce`，MSI `61feeae4c05db4a8ecccf6a2f7e46407ed5f9e595f850d931aae25dfc611ae79`。NSIS 静默安装退出0，安装主程序与候选哈希一致，ProductVersion=3.1.0。个人设置哈希与 worker 修复前安装备份一致；7项 AI 凭据键/值逐项一致（无内容输出）。最终用户启动未执行，以免自动打开私人研究工作区；安装版PDF/设置十阶段回归在相同3.1.0安装基线通过，worker修复在最终安装版15分钟压力流中实测。

Worker修复版通过完整 `npm run qa:gate`（543文件/4785项通过，2跳过），静态产物部署 Cloudflare Pages `main` 成功：`https://66e86c48.lattice-apq-7xj.pages.dev`；版本3.1.0，index SHA256 `ffa5faa9627c20a07edef5631e8876e22908fa6c34c779da8ceb6a2e3cf3334b`。`LATTICE_WEB_URL=https://lattice-apq-7xj.pages.dev/` 是稳定 Pages 项目域；随机前缀为该次部署专属预览URL。没有独立抓取生产页面。

公式OCR首次启用与识别实际记录为 `.lattice-build/desktop-managed-ocr-final-20261020c/result.json`：27项已缓存资源逐项size/SHA256校验后隔离安装；插件设置/本机识别/窗口reload三阶段通过；只用合成PNG，0模型调用、0私人文件、网络请求均被页面路由拦截。Codex包沙箱漫游路径曾超过Windows DLL加载路径限制，换用短隔离profile复测成功；普通用户profile内容和密钥未触及。

本地公式识别准确率另以六张固定合成图片、七种像素输入作对照，见 `.lattice-build/turn-20261020/ocr-accuracy-followup.md`。基线精确匹配为1/6；缩放虽修正一例根号字符却破坏原正确分式，阈值处理亦引入字符误认，矩阵与多行结构仍错误。没有将未经多样语料验证的变换设成默认，也没有自动改写模型LaTeX。该插件“可安装和执行”已通过，“科研公式识别准确”仍未达到要求。

随系统语言的工作流错误提示在本轮补齐中英文资源。简体中文/英文各自覆盖取消、扫描前置条件和切换文档等路径，公式工作流测试7/7、插件周边测试36/36、TypeScript通过；完整门禁和本次变更后的安装/部署验证待后续追加。

最终已安装3.1.0再次通过PDF十阶段回归：`.lattice-build/desktop-safe-closeout-native-20261019/result.json`，profile `quality20261017-1792495249211`、`checkedAt 2026-10-20T11:23:14.043Z`；十阶段、`pageErrors=[]`、模型请求0。另有2分钟活动+2分钟空闲对照 `.lattice-build/native-memory-idle-20261020/result.json`：renderer私有内存约297MiB回落至213MiB，并在随后120秒稳定；V8总堆约98MiB回落至35MiB后稳定，PDF worker保持0。该有限合成结果支持高水位内存回收，不保证任意PDF/GPU路径零增长。
