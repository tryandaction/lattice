# 目录完整阅读开发与验收

状态：3.1.4已通过发布门禁、完成桌面安装和网页部署；云目录持续阅读扩展处于后续开发验收中。本记录只证明明确列出的源码/离线流程，不代表真实模型回答质量。

## 当前实现

`directory-manifest`保存规范授权范围、路径清单、复核轮次与待访问/待复核路径；枚举顺序变化、目录新增/删除/改名与重叠授权不会依赖内存数字游标。复核和新发现交替；时间暂停后从已提交路径继续，完成状态只指这一观察轮。

`directory-research`保存v2任务和各文件v1页/字符checkpoint，一次只打开一个正文源，累计目录大小不作为整批失败阈值。单文件32MB提取上限仍保留，超限/不支持/损坏/无文本均明确留缺口；其他文件继续。恢复使用路径队列，避免旧文件验证前缀反复耗完预算。实际观察版本和时间保留，但不声称文件系统原子快照。

摘要按完整请求预算逐级归约；每个节点绑定子节点、实际范围和批次数，完整摘要及经校验引用留在账本中。最终上下文为有界投影，不假称全部原文进入最终请求。调用/失败/修复共享本轮额度，存储失败、权限撤销、切根或取消后停止下一项。

Composer的Agent和Chat入口都能识别“全部文章/所有论文/读取并综合所有文件”等请求，并保持相关检索的区别；明确页段、否定和方法咨询不扩大读取范围。“做/继续”恢复原session和目录选择，未打开文件或归约剩余也可恢复。目录进度按完整文件账本统计，明细折叠时不挂载数千隐藏行。多PDF总结不误挂到最终引用的一篇PDF；单PDF父级使用账本和实际修订核验。

## 已有独立证据

- `.lattice-build/turn-20261021/directory-reading-seven-files.json`：当时7个文件264项通过、0失败/跳过，包含真实Composer入口、单文档内核、目录内核和发现。后续公平队列/不支持文件/存储改动仍须另验，不将这条旧绿灯算作冻结最终门禁。
- `directory-reduction-red.json`复现归约输入超预算和损坏缓存；修复后`directory-reduction-fixed.json`通过。`directory-file-fairness-red.json`复现已读前缀耗尽后续轮预算；修复后`directory-file-fairness-first.json`通过。
- `directory-fairness-frozen.json`与`directory-unsupported-fixed.json`包含后续路径队列、长页偏移、同元数据字节变化、增删文件、页内不可读继续、非DOM权限失败以及不支持格式不可假完成的离线用例。
- 独立浏览器候选 `.lattice-build/agent-directory-ui-20261022-candidate/result.json`：真实聊天UI对101个新建合成文件，在48/96调用后分别暂停，按钮/自然“继续”复用任务，最后101文件读完并归约；D000/D050/D100均保留。关闭/重开面板、复制按钮、1440与390宽度中英文布局通过；0外部请求、0页面/console错误。复制只验证隔离剪贴板替身，未访问系统剪贴板。待大型账本持久化完成后复验。

所有模型响应均来自离线/loopback确定性替身。没有真实提供商请求、私人资料或生产操作。

## 冻结候选验收

- 精确来源定位：当前源码130项通过，包含截图同款`@Theoretical Research/taiyi/essay/06_fast_long_range_and_native_gates中的文章都阅读并讲述文章内容，对话内回复`、空格路径、同名目录、权限和缺失路径。直接逐级定位指定目录，不枚举无关根目录。
- 冻结浏览器`.lattice-build/agent-directory-ui-20261022-frozen/result.json`：9阶段通过；101文件实际聊天入口、48/96暂停、按钮及自然继续、面板关闭重开、双语390/1440宽布局与Markdown按钮。真实IndexedDB写入7,178,049字节合成任务，刷新回读3200条摘要；事务中止不覆盖旧记录。系统剪贴板未验收。
- `.lattice-build/turn-20261021/session-idb-frozen-final.json`：32项通过；严格事务、旧localStorage仅缺失时迁移、持久化失败不写默认值、加载前动作合并，以及防止旧防抖回调覆盖刚恢复的历史任务。
- `.lattice-build/desktop-directory-314-final-20261022-ipc/result.json`：正式编译3.1.4二进制的6阶段原生验收通过。使用截图同款`@`目录请求，101篇合成Markdown，逐文件检查来源版本和摘要。48篇暂停后正常关闭程序，同隔离profile重开后按钮续到96篇；切到无关`active.md`后“继续”，完成101篇与15归约节点。101阅读+15归约+1终答均为本机无密钥协议替身，无真实模型/私人文档，0页面错误、0外部浏览器请求，语言/皮肤/模型设置保留。
- 首次原生记录`.lattice-build/desktop-directory-314-final-20261022/result.json`仍保留失败：测试将Tauri官方内部`ipc.localhost`误报外网，业务步骤均完成；修正测试精确白名单后新记录全过，没有改写旧证据。
- 完整门禁`.lattice-build/turn-20261021/qa-314-final-result.json`仍保留退出1：lint零错误、类型和文档检查、5201通过/3跳过/0失败、静态导出和Rust编译完成，但微软官方WebView2引导程序下载被沙盒拒绝。后续完整门禁`.lattice-build/turn-20261021/qa-314-network-final-result.json`在允许必要官方打包网络后退出0；原失败记录未改写。
- 本机PostgreSQL回归辅助启动在受限令牌环境中失败，改为直接拥有隔离postgres子进程并用实际连接探测就绪；29项原生恢复集成通过。附件浏览器CSS导入构建失败改为命名空间全局样式，14项浏览器+7项设置回归通过。两处失败均先复现，未跳过用例。

## 3.1.4交付与后续范围

1. `.lattice-build/turn-20261021/install-314-final-result.json`：安装器退出0，安装二进制SHA256与`releases/v3.1.4/lattice.exe`一致，设置与凭据文件更新前后字节一致；未输出凭据值。
2. `.lattice-build/turn-20261021/deploy-web-314-final-result.json`：Cloudflare Pages `lattice-apq/main`部署成功，稳定入口`https://lattice-apq-7xj.pages.dev/`；`.lattice-build/web-314-final-20261022/result.json`验证1440px/390px未登录壳层与设置，版本3.1.4，0页面错误/失败请求/模型调用。旧域名管理权不在当前可用账号。
3. 云目录仍需独立容量/版本/权限/恢复及真实Composer离线专项，当前扩展尚未发布；不能用本地成功替代云源验收。单文件超限与不可解析材料仍如实呈现缺口。

[实施计划](../superpowers/plans/2026-10-22-directory-reading.md) · [全要求覆盖](../superpowers/plans/2026-10-20-requirement-coverage.md)
