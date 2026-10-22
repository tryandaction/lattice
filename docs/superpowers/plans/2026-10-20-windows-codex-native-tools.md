# Windows Codex 原生工具接入

状态：completed（本项Windows原生工具接入）；代码、专项回归、独立审查、完整门禁、生产Rust无模型连接/会话/命令、安装版连接/工具注册及11阶段PDF回归已通过。3.1.0已安装并同步网页，原生工具按每次连接实际检测开放；真实模型终答不在本次验收范围。

## 用户要求和验收

用户要求Lattice接入已安装Codex的实际工作能力，而非只有模型目录和静态回答；同时保留工作区授权与文件提案审查。本轮不调用真实模型，不读私人论文做测试，不修改用户Codex配置，不新增配置板块。

已取得证据：MXC显式后端、`:root=deny`、`:minimal=read`、合成工作区只读及scratch可写时，CLI实际命令通过授权读、scratch写、越界拒绝、只读写拒绝、junction、父目录跳转、子进程继承、Codex合成配置根拒绝和网络拒绝。App Server `command/exec`亦在同一权限profile验证读取/写入/拒绝，0模型调用。记录位于 `.lattice-build/turn-20261020/windows-mxc-*latest.json`。

## 执行步骤

1. 核对官方Windows MXC和本机schema，保留成功与失败探针证据。completed。
2. 为连接命令策略及preflight结果校验添加回归测试，先证明旧实现未满足，再实现最小变更。completed。
3. Windows连接先用同一生产launcher启动独立MXC预检进程，在独立合成profile完成无模型preflight，并确认配置确为MXC、profile允许且MCP隔离。正式连接再次核对后端、工具开关和命令环境。未通过即停止候选，只回退到既有Lattice动态工具且禁用原生shell/patch；不回退全盘读取。
4. 通过时提供原生工作区只读、scratch可写命令；环境只传常用工具所需变量，避免把父进程密钥环境带入命令。正式修改仍通过Lattice提案审查。命令审批不能扩大权限。
5. 调整描述和科研指令，准确区分连接前待检测、检测通过、检测失败；保持跨文件语境目标，按问题检索和读取必要材料，不默认止于前两页。
6. 离线原生fixture、已安装Codex无模型接入/命令、前端回归、完整qa:gate通过后，统一重打包安装和更新网页，保存用户设置。

## 边界

- 原生shell结果不自动成为科研引文，文档证据仍使用Lattice工具的文件版本/页码/定位契约。
- 不新增shell任意权限提升、不接受session-wide grantRoot、不启用继承MCP/hooks/plugins。
- 运行时preflight只使用由应用创建的合成目录；清理仅由TempDir管理其自身目录。
- MXC不受主机支持、被管理策略禁止、命令profile不允许、响应缺失/伪成功/超时均为失败，不伪报能力。
- 本轮完成原生工具可达性/隔离不代表真实模型一定会正确规划调用；真实AI终答由用户体验。

官方依据：[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)、[Permissions](https://learn.chatgpt.com/docs/permissions)。协议参数以本机生成schema为准，特别是 `CommandExecParams.permissionProfile`，不把thread参数 `permissions`误用到命令接口。

## 本轮修复与专项证据

- 命令环境精确白名单、禁用profile/login/snapshot，显式启用并核对shell/patch；继承环境与显式config set合成密钥哨兵均被过滤。官方源码确定set先于include_only，未证实此前怀疑的set绕过，但旧版profile/login继承已实证并修补。
- 连接预检、session创建、最后事件drain期间切换来源/模型/路径均中止旧候选；同对话不同根目录不复用pending连接；发送固定捕获模型。合成红→绿测试覆盖以上竞态。
- 原生54项通过、10项显式推理/安装专项默认跳过；前端Harness/UI 9文件75项通过。
- `production-mxc-session-latest.json`记录生产Rust的真实connect、thread/start、12类工具注册、command/exec读取及scratch产物通过。隔离配置无账号，模型端点127.0.0.1:9，不调用turn/start或真实模型。
- 两轮独立只读审查发现的P1疑点及P2竞态均已核实修补；最后固定范围未发现阻止发布的P1/P2。审查不替代完整门禁或用户真实AI体验。
