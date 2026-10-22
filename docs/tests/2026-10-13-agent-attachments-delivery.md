# 2026-10-13 Agent、目录定位与附件交付

## 桌面状态

本轮 Lattice 3.1.0 已安装至 `C:/Users/XINGLUOYUNSHEN/AppData/Local/Lattice/lattice.exe` 并重新启动。安装器退出码为 0；应用窗口存在并响应。已安装 SHA-256 为 `af8c8deb8ab2f2ca701d60b6477982270f9406ec8a3f7e1e8b9df45f7a6f0351`，与发行包一致。模型配置仍为 Custom (Anthropic Messages) / glm-5.3；本地历史存储仍存在（17 个对话），未打印对话正文或密钥。

发行包：`releases/v3.1.0-agent-attachments-20261013/`。核验记录：`.lattice-build/desktop-agent-attachments-verification-20261013.json`。

## 行为变化

- 自然输入的绝对目录路径经过已授权句柄核实，支持空格和中文；未知、越权或缺失路径不会替换为活动文件。已打开的论文完整文件名直接定位，避免大工作区扫描。代码与 TeX 文字中的路径不自动成为来源。
- API Agent 与本机 Harness 共用 12 个 Lattice 工具，包含来源 list/read/search、技能描述、PDF 批注和子文件读取、审查草稿及有预算的数字计算。目录任务至少成功读取实际正文才可进入论文结论。上传或明确文件请求不使用无关工作区摘要。
- 附件按钮替换来源选择器，支持文件选择、拖放与粘贴。附件按对话持久保存，完整文档与图片输入随原请求重试或恢复，不因另一次上传或文件切换替换身份。明确本地路径和上传附件可以一起使用。
- 图片以真实 PNG/JPEG/WEBP 数据进入五种 API 协议及 Codex 的 inline image 输入。Claude 当前本机桥明确拒绝图片，图片不会静默丢弃。图片传输验证不等于各个上游模型的识图能力认证。

## 验证

`npm run qa:gate` 退出码 0：493 个测试文件通过，4151 项测试通过；1 项真实 API 测试在普通门禁中按设计跳过。ESLint 0 错误、197 条警告；TypeScript、161 份文档检查、Next.js 生产构建、Tauri release 和 MSI/NSIS 两安装器通过。

真实 Chromium 的完整 Panel/Composer/Timeline/IndexedDB 测试 5 项通过，覆盖无工作区 TXT 与 PNG 上传、同会话追问、中文输入法、不可读附件、Codex 图像请求边界。模型 I/O 在浏览器用确定性替身，无外网请求及浏览器错误。额外组件与核心集成 243 项通过，目录定位 100 项通过。独立只读审查发现的附件范围、版本、重试、混合输入、恢复与摘要旁路问题已修补并复核。

用户本轮只授权两次合成真实模型测试，均已用完：

- Custom (Anthropic Messages) / glm-5.3：一次 HTTP 200 请求，使用具体预构建计划取得真实合成文件读和数学结果，回答系数 43、计算值 5 并返回有效引用。这不是模型自主规划全过程的收费验收。
- OpenAI / gpt-6.1-sol：一次 Codex 原生 turn，一次合成文件工具请求；首正文约 21.183 秒，最终标记完整。这验证原生协议和临时文件正文，不是产品 UI 的真实模型端到端验收。

未上传用户论文或私有文件；未进行额外模型请求。相关证据：`.lattice-build/api-agent-live-20261013.json`、`.lattice-build/harness-live-budget-20261013.json`、`.lattice-build/qa-agent-attachments-20261013.log`。

## 云端边界

用户项目地址为 `https://gxsauhzganbnqflmlpnk.supabase.co`。无需 R2 的 Supabase 私有存储部署材料已备齐，当前限制为单文件 5 MiB、默认服务预算 950 MB；支持 JWT/RLS、原子登记与有条件清理。生产数据库迁移、私有桶、Worker 和正式连接配置尚未部署，运营者尚未完成当前官方浏览器登录。普通用户不需要厂商控制台账号。

登录由用户自行操作；用户确认完成前不读取或截图登录过程。不得将已打包代码、PostgreSQL 合成断言或 Wrangler dry-run 当作生产上线。详细部署材料和限制见 `docs/operations/supabase-library-storage.md`。
