# 简洁 AI 和共享库验收

## 产品行为

- AI 来源和模型位于同一个输入工具栏；运行环境、手填模型和程序路径从主界面移除，高级诊断通过设置图标打开弹层。
- Codex/Claude 原生安装自动发现：用户目录、桌面安装、编辑器扩展的原生二进制、npm 原生包和 PATH。显式保存的路径仍优先，不修改系统环境。
- 本机模型从 Codex `model/list`、Claude SDK initialize 控制响应读取；认证只输出 ready/login-required/unknown，不输出个人信息或凭据。默认值与自定义模型仍可用。
- 每个助手分别记忆模型和路径，切换来源不会丢失配置；更换程序后下一次连接使用新程序，断开旧连接不会取消新任务。
- 云库成员粘贴邀请信息、登录、自动加入；管理员公开连接设置折叠。桌面邀请为可粘贴的 JSON，公开 Web 使用 fragment 链接，均不包含账户登录凭据。
- 上传文件/文件夹直接进入队列，目录结构保留；整个批次先验证，单项读取失败不会重传成功项。添加、暂停、离线、失败与已同步状态分开显示。
- 邀请已接受状态绑定用户，刷新失败保留状态并仅重试拉取列表，不重复消费邀请。

## 已执行验证

| 检查 | 结果 |
|---|---|
| Cloud focused suite | 32 文件 / 200 测试通过 |
| Invitation/upload review follow-up | 5 文件 / 27 测试通过 |
| AI/settings integrated regression | 4 文件 / 99 测试通过 |
| AI engine switch replacement regression | store 11 测试通过 |
| Native Harness focused tests | 26 passed / 2 ignored |
| Installed tool metadata, explicitly run ignored test | Codex 8 模型、Claude 4 模型，auth ready，inference=0 |
| TypeScript | 通过 |
| cargo check | 通过，两个既有 dead-code 警告 |
| Browser desktop/mobile | 1280x820 / 390x844，模型/来源在视口内，弹层不改变输入区高度，草稿保留，runtime errors=0 |
| Two-profile cloud rendered HTTP gate | 通过，真实 SQL/RLS，Auth/R2 为隔离 fixture |

Browser plugin 不在当前技能列表中，使用已安装 Playwright 做浏览器交互与截图验收。截图与布局报告在本机临时目录 `C:/Users/XINGLUOYUNSHEN/AppData/Local/Temp/lattice-simple-ux-evidence`，真实云库场景报告在 `.lattice-build/cloud-team-evidence-20261008`。

## 边界

本轮真实推理调用为 0，没有使用用户论文测试收费 API。真实安装和模型目录检测不能替代复杂科研任务的模型能力评价。共享库首次服务搭建仍需要管理员部署现有 Supabase/R2 服务，未创建、部署或声称提供托管云服务；成员使用配置好的邀请即可加入。

## 发布状态

`npm run qa:gate` 已通过：ESLint 0 errors / 197 warnings、TypeScript、文档、470 个测试文件 / 3875 个测试、Next production build、Tauri release build 和 MSI/NSIS 两种安装包均成功。

已用本轮 NSIS 安装器正常更新本机 3.1.0，安装退出码 0。安装前原产品通过 CloseMainWindow 正常保存退出，未强制终止用户进程。发布目录为 `releases/v3.1.0-simple-ux-20261009`，原生 `lattice.exe` SHA256 为 `34081781dbd4a48a555aeabefc25d798d3736113f9516c6ce34180da484b17d6`，安装后大小 19,865,600 bytes 与哈希一致。

安装后使用独立 `LATTICE_DIAGNOSTICS_PROFILE` 和 WebView 用户目录运行真实产品首页：自动发现 Codex 8 模型、Claude 4 模型，选择各自模型、切换来源、保留未发送草稿、正常关闭、全新进程重开。确认两种模型选择独立保留、原草稿完全恢复，工具栏高度约 41px、运行时错误 0、推理调用 0。独立测试 profile 没有读取或改写用户原聊天/API/云库配置。
