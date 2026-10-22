# AI Provider Profiles 与协议扩展规格

## 目标

将 Lattice 的 AI 配置从单一 provider 槽位升级为可管理的多 profile、多协议运行时，同时提供可解释的连接诊断、模型发现、隐私控制、超时/重试和本地/云端渠道选择。

## 设计原则

- 兼容现有 `aiProvider`、`aiModel`、provider 级密钥和 Base URL 设置。
- Profile 元数据与密钥分离保存；UI 永远不回显完整密钥。
- 协议负责请求/响应格式，provider profile 负责端点、认证和模型默认值。
- 浏览器直连失败必须给出 CORS/代理诊断，不伪装为普通网络错误。
- 所有新增能力先通过纯函数和 provider contract 测试，再接入 UI。

## Profile 模型

`AiProviderProfile` 包含：`id`、`name`、`provider`、`protocol`、`baseUrl`、`model`、`enabled`、`isDefault`、`authMode`、`organization`、`project`、`timeoutMs`、`maxRetries`、`customHeaders`、`privacy`。密钥只通过 profile-scoped key storage 读取。

内置 profile 预设：OpenAI Chat/Responses、Anthropic、Gemini、Ollama Native、OpenRouter、Groq、Together、Fireworks、SiliconFlow、Azure OpenAI、Custom OpenAI-compatible。兼容渠道通过统一 OpenAI-compatible 实现，不复制 provider 逻辑。

## 协议适配

统一 `ProtocolAdapter` 接口：

- `buildRequest(input): ProtocolRequest`
- `parseResponse(response): AiGenerateResult`
- `parseStream(response): AsyncIterable<AiStreamChunk>`
- `listModels(input): Promise<AiModel[]>`
- `testConnection(input): Promise<AiConnectionTestResult>`

第一阶段实现 Chat Completions、Responses、Anthropic Messages、Gemini Generate/Stream、Ollama Native。Responses 解析 `output_text` 和 `response.output_text.delta` 等 SSE 事件；Chat Completions 解析 `choices[].message/content` 和 `choices[].delta.content`。

## 连接诊断

`AiConnectionTestResult` 增加 `code`、`httpStatus`、`latencyMs`、`requestId`、`diagnostics`。错误分类：missing_credentials、cors_or_network、timeout、unauthorized、forbidden、not_found、rate_limited、server_error、protocol_mismatch、invalid_response、unknown。不得把 API Key 写入错误消息、日志或诊断对象。

## 设置交互

AI 设置采用 Profiles、Connection、Models、Generation、Privacy、Advanced、MCP 分区。支持创建/复制/重命名/删除 profile、设为默认、按 profile 测试、刷新模型、显示协议和认证方式。旧单 provider 字段作为迁移后的默认 profile。

## MCP 基础

新增 MCP server 配置模型，支持 stdio 和 Streamable HTTP 元数据、启用状态、工具/资源/提示词权限和审批模式。第一阶段只保存配置、展示能力和授权状态，不自动执行远程工具；工具执行继续经过现有 Agent Tool Broker 审批。

## 非目标

- 不在浏览器中暴露 API Key 到第三方日志或 URL（Gemini 旧 query-key 兼容路径除外，优先迁移到 header）。
- 不新增运行时依赖。
- 不实现任意远程 MCP 工具的自动执行。
- 不部署云端代理服务。
