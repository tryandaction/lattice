# 用户历史要求覆盖表

本表用于防止跨窗口遗漏。`实现/离线通过` 不等于真实模型回答满意、任意 PDF 均精准或生产运维全部上线。主线负责整合和产品更新，专项 Agent 提供当前工作树审查及可复现修复；不另起无人收敛的功能分支。

最新目录进展见 [10月22日目录交付证据](../../tests/2026-10-22-directory-reading.md)：3.1.4已完成门禁、桌面安装和网页部署；其他领域基线仍以[10月21日版本证据](../../tests/2026-10-21-final-delivery.md)为准，不用目录新验收代替其他领域。

本轮主交付：[2026-10-20 当前交付](../../tests/2026-10-20-final-delivery.md)；前后对照：[整合验收](../../tests/2026-10-20-integrated-closeout.md)。详细待办及外部条件：[剩余收尾实施计划](2026-10-19-remaining-closeout-execution.md)。

| 用户要求 | 当前实现和证据 | 当前状态/后续责任 |
| --- | --- | --- |
| API 配置不丢、重开不重新配置 | provider profiles、settings/secure key storage；更新前后个人设置字节一致、7项凭据键值一致 | 安装保留通过；AI专项及全量测试覆盖配置路径 |
| 同一对话记忆、重开恢复、切文件追问保持目标 | `chat-session-persistence`、conversation source binding/targeting、task context；202项AI专项、继续意图浏览器回归 | 实现/离线通过；不再调用模型，真实终答由用户体验 |
| “做/继续”承接上一轮，不能重新问做什么 | intent与已验证证据分开，恢复时重新读取来源；合成20页PDF第12页证据回归 | 当前浏览器2项通过；旧真实失败保留 |
| AI按问题读取完整论文/根目录必要文件，不止前2页 | `document-research`、`source-index`、页/字符游标、工作区工具授权与当前对话目标分开；3.1.2 修复精确相对目录识别因空格落回全树扫描 | 3.1.2全量已通过；3.1.3新增明确缺失目录防误读和引号路径回归；真实模型不做额外测试 |
| 跨文件/文件夹检索、索引、主动定位 | `source-index`及精确路径保持；3.1.4本地目录v2持久清单、逐文件阅读、分层归约、自然继续与完整文件进度 | 101文件真实Composer与同版原生冷启动恢复通过，网页大账本迁移/全量门/安装保留设置/网页同步已交付；云目录扩展仍单独开发验收，见[目录计划](2026-10-22-directory-reading.md) |
| 输入@选择文件难以使用、候选浮层错位 | 候选锚定composer rect、ResizeObserver/scroll/visualViewport重新定位；目录逐层浏览、当前文件夹直接引用、Enter捕获 | 3.1.2原生目录/定位通过；3.1.3修正选完重弹、光标时序和慢加载状态，193项专项及同版桌面实测通过 |
| 超时/429/截断/无进展恢复，不丢已有成果 | `request-lifecycle`、rate-limit recovery、answer execution/output budget、批次检查点 | 离线故障回放覆盖；模型上游可靠性不能保证，历史空答未改写为成功 |
| 引文不能是p.3(Unresolved)或裸citation地址 | citation contract/validation/history、evidence navigation、引用渲染 | 当前单测/全量门禁通过；不可定位引用不能伪造定位 |
| AI编辑写文件、新建Markdown和PDF子文件 | guarded write proposals、`pdf-child-skill`及cloud版本、原生受限工具桥 | 离线通过；严格授权工作区写入，不放开整盘；真实模型是否实际完成待体验 |
| 接入本机Codex/Claude，模型选择、会话恢复、可见工作过程 | Harness探测/目录/会话/工具事件；54原生回归、75项Harness/UI通过；生产Rust连接/会话/命令和安装版连接/工具注册无模型验收通过 | Windows逐连接检测MXC后开启受限shell/patch，失败关闭；来源/模型/路径/工作区切换竞态已补；真实模型终答未验收，Claude上游拒绝按用户要求暂缓 |
| Markdown复制、长输入/文件图片附件、简洁AI界面 | answer markdown/copy button、long input/attachments、合并模型展示、工具进度 | 当前AI专项/全量回归通过，不公开隐藏推理；真实思考只能显示provider公开事件 |
| 原PDF三点菜单可点击编辑，不额外堆图标 | 安装版合成PDF三点菜单打开、编辑并保存评论 | 当前安装版实际通过 |
| PDF批注/子文件绑定文件身份，父子根、改名移动不能消失 | document binding/item location registry/reconciliation | 安装版父→子→父、重开、改名、移根实际通过；注册元数据必须仍存在且可访问 |
| 同名/同字节独立PDF不串批注 | 独立文档身份及来源root关联 | 当前安装版独立副本隔离通过 |
| 跨段/列/页选区顺序，左下到右上不反转 | reading order、multi-page selection/canonical anchoring | 359项PDF专项及10项跨页双栏通过；任意扫描PDF不保证自动准确 |
| 完整公式渲染、批注识别LaTeX、复制MD/LaTeX | formula selection/structure/content，保留原文/图片、可校正结果与导出共源 | 组件与合成拖选通过；系统剪贴板公式拖选仍未真实验收 |
| 公式识别插件无需PATH手动后端、要可用可纠错 | managed OCR隔离运行时、校验/下载/取消/修复；固定Pix2Text-MFR-1.5，校验资源约171MiB | 已在隔离桌面配置用合成图实际识别；27项缓存资源校验通过、窗口重开仍可用。六类合成样例精确匹配1/6；无安全通用预处理改善，3.1.2的72图对照显示根号/2×2矩阵/多行结构改善，部分字体和3×3结构仍有误差。不得视作任意公式精度达标；网页图片OCR仍desktop-only |
| 公式插件界面随系统语言显示，错误提示不能中英混杂 | workflow自有错误使用全局i18n键；保留未知系统异常原文 | zh-CN/en-US错误路径回归、完整门禁通过；新安装版实际中文缺失选区错误路径通过 |
| 插件体系可扩展且易用 | plugin registry/worker host/权限、命令、面板、设置；本轮修复权限ID/英文命令泄漏 | 59项插件/appearance专项通过；未宣称任意第三方插件均兼容 |
| 多套个性皮肤、自定义/AI设计主题、全界面一致 | 5套内置主题、主题包校验/导入/编辑/克隆、持久化 | 本轮修复英文色名/错误与克隆名；历史70页面矩阵；安装版自定义主题/语言恢复通过 |
| 中文不混英文、更新记住语言皮肤模型配置 | i18n和settings合并迁移，内置元数据本地化，保留第三方名称 | 59项专项/安装实际通过；底层I/O诊断原文保留，不宣称全产品零英文 |
| 文件导航栏可缩窄、外部修改实时反映 | resizable layout、windowed tree、native watcher/visible branch reconcile | 6000文件380轮刷新p95 828ms；本轮补目录瞬时读取失败一次重试 |
| 文件拖入添加、树内移动/复制、冲突/取消安全 | staged desktop import、隔离browser import、atomic conflict guards | 84项相关回归及历史原生流程；真实Windows Explorer鼠标拖放未验收 |
| 云端像本地文件夹，不另造查看界面、不限保存格式 | 共用Explorer/UniversalFileViewer、tabs、文件目录上传；未知格式保留原字节 | 当前云端77项/RLS45项及历史生产双成员证据；不承诺任意格式都可内嵌编辑 |
| PDF上传带批注/子文件、昵称/作者标签、右键上传 | PDF bundle upload、children/annotation author metadata、成员昵称与快捷入口 | 历史双成员及20MiB生产检查已记录；本轮不访问生产对象 |
| 低成本可商业化云端，账号/邮件确认/会话稳定 | Supabase私有Storage/RLS，SMTP用户已保存；持久通知、离线恢复、原生PG共享快照/空库恢复、物理Storage禁覆盖写回及已有平台数据导入 | 通知68项/离线恢复31项/原生PG15项/Storage15项、平台导入20项通过；新增真实本机Auth/PostgREST新登录、确认、刷新/退出及真实RLS链路1项完整通过。托管兼容、旧会话/平台根密钥/官方Storage整体验收和生产渠道/身份/预算/独立介质仍缺 |
| 网页与桌面跟进开发，不能打开旧版确认页 | 同一源码静态导出、本轮Cloudflare main部署 | 稳定入口 `https://lattice-apq-7xj.pages.dev/`；部署预览见最终交付记录；旧项目 `lattice-apq.pages.dev` 无当前控制权 |
| URL从文件过滤器分离，网页来源索引，本地HTML预览/编辑 | web-source-menu、web address draft、native WebView导航状态 | 19项定向及历史8阶段桌面通过；本轮同源码构建/网页部署 |
| 网页打开白屏闪烁、重定向/返回前进不稳定 | 宿主生命周期与导航解耦、最终URL回传、错误/取消恢复 | 本机合成站点回归通过；任意生产站点不保证内嵌兼容 |
| 整体卡顿和性能 | 3.1.3安装hash核对后6000文件、15min/382轮外部修改及120s静置；更新p95 836ms、文本222ms、PDF507ms、输入97ms | 无页面/console错误，40次PDF关闭worker检查均0；GC后JS堆约36.8MB稳定，总进程仍有GPU/原生缓存成本，非任意机器内存上界保证。OS拖放未验收 |
| 开发完统一更新桌面和网页，保留偏好 | 3.1.3通过全量门禁、安装保留设置/凭据并同步网页；同版桌面 AI/PDF 与网页桌面/手机壳层验收通过 | 已交付；真实模型终答按用户要求留给用户体验，云端运营资源和系统级拖放仍按下方边界管理 |

## 尚需主线继续推进的确定事项

1. 有原生桌面输入控制的环境中验收Windows Explorer拖放和公式系统剪贴板；当前接口禁止，不能用DOM事件替代后标通过。
2. 云端生产持续身份、通知目的地/渠道适配、费用权限、独立存储/密钥托管和恢复项目仍缺运营资源。内部通知与离线恢复已实现，10月22日新增原生PG四schema共享快照/独立空库事务恢复、物理Storage写回、已有平台结构的数据导出及受保护数据导入；导入最终20项与独立复审通过。角色自动恢复及独立项目API/Auth/SMTP/物理Storage完整恢复一体演练仍有开发/验收工作，不能全部归为外部阻塞。见 [数据库证据](../../tests/2026-10-22-postgres-recovery.md)、[物理Storage证据](../../tests/2026-10-22-storage-recovery.md)、[平台导出](../../tests/2026-10-22-platform-recovery.md) 和 [平台导入](../../tests/2026-10-22-platform-restore.md)。
3. 当前可控公开分发渠道上发布可校验安装包；旧网页域的管理权目前不在可用账号。
4. 新OCR模型在根号、2×2矩阵、多行结构上有改善，部分字体和3×3矩阵仍有误差；不能用运行时安装成功或符号计数代替数学准确率。保留用户校正与原图，不自动猜改科研公式。
5. 本地目录v2与101文件同版原生/浏览器验收已随3.1.4交付；云目录同类规模路径正在扩展，待独立容量/版本/权限/恢复与Composer验收后再发布，不用本地证据替代，见[实施计划](2026-10-22-directory-reading.md)。

最新3.1.3安装版完整耐久证据 `.lattice-build/native-endurance-313-20261021-final/result.json`；先前启动时诊断桥失效的失败记录 `.lattice-build/native-endurance-313-20261021/result.json` 保留。修正测试等待后完成901715ms活跃、120s静置，worker生命周期检查40次均0；JS堆与总进程内存分别记录。残余GPU/原生缓存判断不凭短期GC代替长期上界保证。

不再安排真实模型请求、不再索取密钥/密码；已授权范围内的代码、合成测试与已有发布目标可继续执行。
