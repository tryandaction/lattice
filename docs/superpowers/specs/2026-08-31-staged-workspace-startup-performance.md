# 分阶段工作区启动性能优化规格

## 目标

打开工作区时先在可感知的短时间内显示根目录并允许打开首个文件；深层目录、历史标签、PDF Item 元数据、AI 工作区索引和 Markdown 链接索引在首屏之后分阶段执行，避免工作区规模、历史标签数量或 PDF 批注数量线性阻塞启动。

## 当前根因

`applyWorkspaceHandleToStores` 在发布根节点之前同步执行 PDF Item 迁移、目录递归读取和 UI 状态恢复。`setRootHandle` 还会触发 AI workspace index 与 Markdown link index。会话恢复随后可能并行解析多个文件句柄。这些任务叠加导致左侧 Explorer 长时间停留在 loading 状态。

## 设计

### 1. 分阶段工作区打开

新增单层目录读取器，只读取当前目录的直接子项并复用既有过滤、排序和 PDF 虚拟子文件标记。打开工作区时：

1. 解析工作区身份和轻量 UI 状态。
2. 读取根目录直接子项。
3. 立即设置 `rootHandle`、workspace identity、root path 和根目录树，并结束首屏 loading。
4. 在空闲任务中执行 PDF Item 迁移、manifest/location 索引、AI index 和 Markdown link index。

首屏失败只报告根目录读取错误；后台任务失败记录可诊断 warning，不阻塞文件树。

### 2. 目录按需展开

`DirectoryNode` 增加 `childrenState: "idle" | "loading" | "ready" | "error"`。目录首次展开时读取该目录的一层，之后复用已加载 children。以规范化路径为 key 做 in-flight 去重，并使用 workspace generation token 丢弃过期结果。目录刷新、创建、移动、重命名仍通过现有树操作和局部重建路径处理。

### 3. PDF 虚拟子文件

PDF 主文件仍只在用户展开时执行 `hydratePdfVirtualChildren`。PDF Item manifest、批注 Markdown 同步和 location registry 不得进入工作区首屏 await 链。既有 PDF 虚拟节点状态机保持兼容。

### 4. 历史标签恢复

会话反序列化先恢复每个 pane 的活动标签；其余标签按每批最多 2 个、批次之间让出主线程的方式补入。单个失效文件只被跳过，不阻塞已恢复标签。恢复过程使用 workspace generation token，切换工作区后旧任务不得修改新布局。

### 5. 可观测指标

开发环境记录以下时间点，不持久化用户内容：

- workspace-open-start
- root-tree-ready
- first-file-ready（若首个标签存在）
- background-index-complete

性能回归至少覆盖：模拟 1,000 个根层条目时根节点读取不递归；目录展开只读取目标目录；切换工作区后旧异步结果不提交；历史标签恢复批次不会阻塞根节点。

## 非目标

- 不升级 npm/Rust 依赖。
- 不改变 PDF 批注数据格式和文件路径契约。
- 不部署 Web，不上传 GitHub，不执行 Git commit/push。
- 不移除现有完整刷新能力；手动刷新仍可显式执行递归扫描。

## 验收标准

1. 工作区根目录显示不依赖深层目录读取完成。
2. 根目录文件可在后台索引完成前打开。
3. 目录首次展开显示 loading 状态，加载完成后可重复展开/收起且不重复读取。
4. 快速切换两个工作区不会出现旧目录、旧标签或旧索引内容串入。
5. 受影响单测、类型检查、文档检查和浏览器首屏/移动视口验证通过。
