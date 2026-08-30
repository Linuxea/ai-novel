# 作品目录垂直切片

`projects` 是目标模块化单体中首个投入使用的完整业务切片。它覆盖纯领域规则、应用命令与查询、SQLite 仓储、事务 outbox、API v1、RSC 首屏和客户端交互，用来验证同一业务能力可以沿模块边界端到端工作。

## 领域与版本

`NovelProject` 拥有稳定 UUID、标题、副标题、题材、核心梗概、目标读者、目标字数、生命周期、按角色划分的模型 ID 偏好、聚合版本和项目序列。创建后的 `version` 与 `projectSequence` 均为 `1`；每个实际改变状态的成功命令恰好各增加一次。写命令必须携带 `expectedVersion`，版本不匹配时返回 `projects.version_conflict`，状态与 outbox 均不写入。

活跃生命周期为：

- `planning → writing`
- `writing → revising | completed`
- `revising → writing | completed`
- `completed → revising`

任一活跃状态可以归档。归档记录原状态，恢复时回到该状态；`archived` 不能通过普通状态迁移进入或离开。

模型偏好按 `chat`、`writing`、`review`、`embedding` 四个角色保存模型 ID。空值表示继承全局默认，数据模型和 API 均没有 API key 字段。

## 应用与持久化

应用层声明项目仓储、Unit of Work 和事件 outbox 端口。生产组合根在模块 infrastructure 内连接平台 SQLite 与 outbox；测试可以直接注入内存或故障端口。仓储实现不从模块公开入口导出。

真实迁移创建：

- `projects`
- `project_model_preferences`

项目状态和 `projects.project.<action>.v1` 事件在同一个同步 SQLite Unit of Work 中提交。创建、编辑、状态迁移、归档、恢复分别产生 `created`、`updated`、`status_changed`、`archived`、`restored` 事实事件，信封聚合固定为 `projects/project`，信封聚合版本等于提交后的项目版本。

## HTTP 与界面

新接口位于 `/api/v1/projects`，包括列表、创建、详情、编辑/状态迁移、归档与恢复。路由只负责解析版本化 Zod 合同、调用模块公开用例并映射统一响应；请求格式错误返回 400，领域校验返回 422，不存在返回 404，版本冲突返回 409，意外错误返回无内部细节的 500。

根路径 `/` 是 SQLite 作品台，详情路径暂为 `/studio/[projectId]`。两者由 RSC 获取首屏；TanStack Query 管理后续服务器状态，React Hook Form 与 Zod 管理表单，Zustand 不复制项目数据。新作品链接只进入 `/studio`，不会进入依赖旧文件 store 的 `/projects/[id]`。

## 新旧并存

本切片只迁移作品目录和项目设置。旧 `/api/projects`、`/projects/[id]`、`src/lib/storage.ts` 与 `data/projects` 仍服务旧详情中的人物、设定、叙事和稿件能力，不会被新 SQLite 项目调用或自动导入。后续模块完成数据兼容与回归验证前，两套入口必须继续隔离共存。

公共 `NovelExportManifestSchema` 定义导出格式版本、作品 ID/版本、导出时间、模块清单和 SHA-256 校验信息。当前只注册 `projects` 模块贡献，并明确拒绝把 SQLite 数据库文件作为交换格式。
