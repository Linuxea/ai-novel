# 目标架构

本目录定义墨章从现有文件存储应用迁移到 Next.js 16 模块化单体的架构边界。部署单元仍是一个 Next.js 应用，业务按垂直模块隔离，基础设施通过平台入口组合，不拆分网络服务。

运行时基线为 Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`，与当前 jsdom 支持线一致并满足内置 `node:sqlite` 要求。Drizzle ORM/Kit 精确固定为匹配的 `1.0.0-rc.4`，在 Node SQLite 适配进入稳定线前不得使用范围版本。

## 设计目标

- 让领域规则可在 Node 环境独立测试，不依赖 Next.js、数据库或 AI 提供商。
- 让每个模块只通过公开入口协作，内部结构可以独立演进。
- 以聚合版本和变更集保护并发写入，以快照加速恢复而不牺牲审计能力。
- 以事务 outbox 可靠传播领域事实，并接受至少一次投递语义。
- 让 AI 成为可替换能力；AI 失败不得破坏核心写作流程。

## 目录入口

- [领域词汇与六个模块](./domain-and-modules.md)
- [首个作品目录垂直切片](./projects-vertical-slice.md)
- [模块依赖规则](./module-dependencies.md)
- [事件信封与 outbox](./events-and-outbox.md)
- [错误、版本、变更集与快照](./errors-versioning-and-snapshots.md)
- [SQLite、后台任务与可观测性平台](./database-jobs-observability.md)

## 代码布局

```text
src/
  modules/
    projects/
    canon/
    narrative/
    manuscript/
    changes/
    intelligence/
  platform/
    database/
    events/
    jobs/
    ai/
    observability/
  shared/
    contracts/
```

每个 `src/modules/<module>/index.ts` 是模块公开入口；跨模块代码不得引用该入口以下的内部路径。`src/platform/<capability>/index.ts` 是平台能力入口。`src/shared/contracts` 只承载确实需要跨模块共享的稳定契约。

## 与现有实现共存

作品目录已经完成首个垂直切片：根路径 `/`、`/studio/[projectId]` 与 `/api/v1/projects` 使用新 SQLite 项目聚合。旧 `/api/projects`、`/projects/[id]`、`src/lib/storage.ts`、`src/lib/application/project-commands.ts` 以及 `data/projects` 仍承载尚未迁移的人物、设定、叙事与稿件能力。新作品不会链接到旧详情，两套数据也不会自动互读。在其余垂直切片完成迁移、数据兼容和回归验证前，旧实现继续是有效实现，不得删除、改写或绕过。
