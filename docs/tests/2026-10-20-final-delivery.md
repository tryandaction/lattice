# 2026-10-21 当前 3.1.0 交付状态

此页记录 Windows Codex MXC 与连接竞态修复后的已安装产品，覆盖此前候选版本状态；不将尚未验收的能力写成完成。文件名为既有稳定引用，更新时间为北京时间2026-10-21。历史详细性能和OCR记录见 [整合验收](2026-10-20-integrated-closeout.md)。

## 当前已交付

- 公式插件扫描、源文档变化、选择、复制和导出等工作流自有提示随当前系统语言显示；中英文使用统一翻译资源。未知系统异常保留原始诊断文本。
- 原 PDF Worker 生命周期修复仍包含在本轮；关闭文档时幂等等待 transport 清理并销毁外部 worker，加载失败也释放任务及 worker。
- Windows Codex 连接时用独立合成目录实测 MXC：工作区只读、scratch可写、越界/原文写入/网络访问拒绝、继承与显式config set密钥变量被过滤。显式关闭profile/login/snapshot，核对shell/patch开启与精确命令环境；失败关闭原生工具并保留Lattice动态工具，不扩大权限。
- 连接预检、session创建、最后事件读取期间切AI来源/模型/执行路径会停止旧候选；不同工作区不复用同对话pending连接；正文发送固定捕获模型。专项Harness/UI 75项、原生54项通过，10项安装/推理测试默认忽略；另显式运行无模型安装专项。
- 完整 `npm run qa:gate` 退出0：544个测试文件、4799项测试通过；2文件/2项跳过。ESLint 0错误、200警告；TypeScript、188份文档检查、Next.js静态生产构建、Tauri/Rust、MSI/NSIS打包完成。Rust保留5条未使用代码警告。
- 3.1.0 已静默安装，安装主程序与归档SHA256一致；个人设置与凭据文件安装前后逐字节一致，没有输出凭据。
- 安装版用隔离合成工作区通过11阶段：PDF打开、原三点菜单编辑/保存、子文件身份关联、重开恢复、语言/自定义皮肤/深色恢复、父根→子根→父根、外部改名、同字节独立副本隔离、移到新根恢复、公式工作流中文错误。`pageErrors=[]`，模型请求0。
- 安装版通过实际IPC连接本机Codex、合成MXC检测、session建立及12类动态工具注册；另外生产Rust连接/会话/command执行实际生成合成产物。没有账号、turn/start或真实模型请求，不等同模型最终规划/回答验收。
- 同轮Web静态产物部署Cloudflare Pages `main`成功。稳定入口：[Lattice Web](https://lattice-apq-7xj.pages.dev/)；本轮不可变部署：[9ff329e0](https://9ff329e0.lattice-apq-7xj.pages.dev)。独立浏览器桌面/手机尺寸检查范围为首次启动、工作台和设置/版本显示，不等同所有线上交互通过。

## 工件

目录：`releases/v3.1.0-mxc-closeout-20261021/`。

| 工件 | SHA256 |
| --- | --- |
| lattice.exe | `78b64007db7fcdedabee52685a586cf5a690a198d434c52c94c2ec0e257117ac` |
| Lattice_3.1.0_x64-setup.exe | `5c020a7f10411bd060a49461fd578d293ad093fc19228eaaa89ec2e6af552e23` |
| Lattice_3.1.0_x64_en-US.msi | `bb957557092a2907338bd7fe57aa33f995036bf80a8594f7bee93cd5d4647c97` |

Web index SHA256：`947dea384f220f0a775eabb2dc8b6712cc88bbb65adf1f16dee456524d04cfac`。

安装/归档/测试聚合记录：`.lattice-build/turn-20261020/final-delivery.json`；安装后11阶段：`.lattice-build/desktop-mxc-final-native-20261020/result.json`；安装版Codex：`.lattice-build/turn-20261020/installed-mxc-connect-latest.json`；网页：`.lattice-build/web-mxc-final-20261020/result.json`。用户设置备份：`.lattice-build/install-backup-20261020-mxc-final/`，不属于发行包。

## 证据边界和未闭环

1. AI真实终答按用户要求留给其自行体验，本轮模型调用0；离线工具/历史回放不能证明任意上游模型的质量、长回答和成本稳定性。
2. Windows Codex本机MXC runner与生产会话无模型执行通过；运行时逐连接检测后开放原生工具。不支持MXC的主机仍用Lattice动态工具。没有真实模型工具调用验收，也未证明任何第三方软件/UNC/硬链接/复杂项目命令都兼容；不能宣称完整复刻Codex。审计：`.lattice-build/turn-20261020/windows-codex-scope-audit.md`。
3. 图像公式OCR的隔离安装、运行和重开通过；六类合成图仅1/6精确匹配，部分等价格式不计为字符错误，但根号符号、矩阵结构、多行对齐存在真实错误。七种像素输入对比未建立安全通用增益；模型输出未被猜测改写。准确率尚不达科研要求。审计：`.lattice-build/turn-20261020/ocr-accuracy-followup.md`。Web图像OCR仍需桌面运行时。
4. 15分钟性能/Worker归零与120秒静置/GC证据属于此前worker修复构建 `3dd46937…`，并非重跑本轮 `78b64007…` 的完整耐久。本轮修改原生工具策略/连接状态并做11阶段安装回归。有限合成PDF不证明所有扫描文档/GPU资源零增长。
5. Windows Explorer真实鼠标拖入及系统公式剪贴板仍未真实验收；DOM事件不替代系统级证据。
6. 云端产品路径有历史双成员/RLS证据；持续监控身份、通知/费用告警、独立加密备份及全项目恢复演练所需资源仍未落实。公开安装包分发与旧域 `lattice-apq.pages.dev` 的管理控制权也未落实。没有把本地演练说成生产运维完成。

未提交、推送Git或创建发布标签。

## 执行偏差记录

Windows沙箱探针代理因PowerShell `$home` 与只读 `$HOME` 冲突，误写用户根目录 `C:\Users\XINGLUOYUNSHEN\config.toml`，不是 `.codex/config.toml`。该399字节合成权限文件没有凭据。发现后停止；主线以SHA256和精确UTC创建/修改时间重新验证后，先备份到 `.lattice-build/turn-20261020/incident-backup/generated-user-root-config.toml` 并复核，再移除唯一生成目标。没有原始写入前的存在性记录，不能绝对排除覆盖原有无关文件；未隐瞒该不确定性。后续仅在核对路径的任务自有隔离配置中恢复无模型验收，没有扩大产品权限。详细记录：`.lattice-build/turn-20261020/windows-sandbox-probe-incident.md`。
