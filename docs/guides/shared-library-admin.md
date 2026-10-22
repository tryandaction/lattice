# 共享研究库管理员指南

> 面向 Library 的 admin / owner：成员管理、冲突处置与活动审计。
> viewer 看不到任何管理入口。

## 1. 成员管理

管理入口由 `member.manage` 能力控制（admin / owner）。

- **邀请**：输入邮箱 + 角色（viewer / commenter / editor / admin）。
  影响范围：将该成员加入本 Library，角色应用于所有集合。
- **角色变更**：沿晋升阶梯 `viewer → commenter → editor → admin`，绝不自动提升到
  owner。影响范围：新角色作用于本 Library 内所有集合。
- **暂停**：阻止访问，但不移除成员或其批注。影响范围：只影响访问，保留数据。
- **撤销访问**：移除对该 Library 内所有共享内容的访问。影响范围：立即生效。

> 自己不能被自己操作；owner 的撤销/降级需谨慎（建议保留至少一名 owner）。

## 2. 冲突中心

入口为冲突面板；每个冲突卡片显示：

- 实体（Item/批注）标题与类型；
- 双方版本：`v3 (local) · user-1` / `v4 (remote) · user-2`；
- 推荐动作与可恢复 payload。

解决动作（分别对应不同 operation）：

| 动作 | 说明 |
|------|------|
| Keep local | 保留本地版本 |
| Adopt remote | 采用远程版本 |
| Copy as new item | 把冲突版本复制为新 Item |
| Merge annotations | 合并批注修订 |
| Restore deletion | 恢复被删除的实体 |

> 未授权用户（viewer）可见冲突但不可解决。

## 3. 活动流

活动面板按时间倒序展示：创建、更新、批注、评论、上传、删除、恢复、邀请、角色变更、
冲突解决。用于审计"谁在什么时候改了什么"。

## 4. 权限能力矩阵速查

- `library.read / item.read`：viewer 起。
- `annotation.create / comment.create / comment.editOwn`：commenter 起。
- `item.create/update/move/delete、itemChild.create、version.create`：editor 起。
- `member.manage、collection.manage、item.restore、library.update、comment.editOthers`：admin 起。
- `library.delete`：owner 专属。
