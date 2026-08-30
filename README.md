# 墨章 · AI 小说生成器

与 AI 协作，从零构建你的小说世界：通过对话设定世界观、人物、剧情，AI 自动沉淀到资料库；可视化角色关系图谱；AI 辅助逐章写作。

## 功能

- **AI 对话构建**：多轮对话，AI 主动引导并自动记录世界观 / 人物 / 剧情 / 关系 / 章节大纲（流式输出）
- **角色关系图谱**：交互式节点图（React Flow），可拖拽、缩放，关系按类型配色，位置可保存
- **设定资料库**：角色、世界观（分类）、剧情（按幕）的结构化管理，可浏览编辑
- **章节写作**：基于大纲 + 角色 + 前文的 AI 流式正文生成与续写，Markdown 编辑 / 预览
- **新作品台**：SQLite 作品目录、分页检索、元信息与创作目标、按角色模型偏好、归档 / 恢复和乐观并发
- **旧项目管理**：原文件项目详情继续提供人物、设定、剧情、章节以及 zip 导入 / 导出

## 快速开始

### 1. 安装依赖

需要 Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`。

```bash
npm install
```

### 2. 配置 DeepSeek API

复制 `.env.example` 为 `.env.local`，填入 DeepSeek API Key：

```bash
cp .env.example .env.local
```

| 变量 | 说明 |
|------|------|
| `AI_API_KEY` | DeepSeek API Key |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` |
| `AI_MODEL` | 默认 `deepseek-v4-flash`；更强可选 `deepseek-v4-pro`（项目设置页也可覆盖） |
| `DATA_DIR` | 旧文件存储根目录，默认 `data` |
| `DATABASE_PATH` | 新平台 SQLite 路径，默认 `data/ai-novel.sqlite` |
| `PLATFORM_WORKERS_ENABLED` | 是否在 Node 服务运行时启动 outbox/job 工作器，默认 `true` |
| `PLATFORM_WORKER_INTERVAL_MS` | 工作器轮询间隔（毫秒），默认 `1000` |

> 模型需支持 **工具调用（function calling）**（V4 已支持）。未配置 `AI_API_KEY` 时对话页会给出友好提示。

### 3. 启动

```bash
npm run dev
```

打开 http://localhost:3000 进入新作品台。新建作品后会进入 `/studio/[projectId]`；尚未迁移的人物、设定、剧情与章节功能仍保留在旧 `/projects/[id]` 详情中。

## 数据存储

新作品目录、项目元信息、创作目标、生命周期和模型偏好以 `data/ai-novel.sqlite` 为权威存储，由根路径 `/`、新工作台 `/studio/[projectId]` 和 `/api/v1/projects` 使用。旧 `data/projects/<id>/` 文件树仍是人物、世界设定、剧情和章节等未迁移能力的权威存储，由旧 `/api/projects` 与 `/projects/[id]` 使用。新作品不会进入依赖旧文件 store 的页面，数据库代码也不会读取或改动 `data/projects`。

两套存储处于明确的迁移并存期，不能用 SQLite 备份替代旧项目导出，也不能把旧 zip 当作新 SQLite 项目的隐式导入。公共 `NovelExportManifestSchema` 已定义版本化导出清单、模块贡献与 SHA-256 校验信息；当前只注册 `projects`，尚未实现完整 zip 导出，且 SQLite 数据库文件不是交换格式。

SQLite 连接启用 WAL、外键和 busy timeout，并只应用 `drizzle/` 中已生成的 SQL 迁移，不在运行时执行 schema push。Node runtime 默认启动全局单例 outbox/job 轮询；构建、测试、Edge runtime 或 `PLATFORM_WORKERS_ENABLED=false` 时不启动。

### SQLite 迁移、检查与备份

```bash
npm run db:generate
npm run db:migrate
npm run db:check
npm run db:backup -- backups/ai-novel.sqlite
npm run db:restore -- backups/ai-novel.sqlite
```

`db:backup` 使用 SQLite 一致性备份并在原子替换前执行完整性检查。执行 `db:restore` 前必须停止应用和平台工作器；恢复先写临时文件、验证后再原子替换，平台恢复 API 还会拒绝覆盖本进程中打开的数据库。以上命令只作用于 `DATABASE_PATH`，不会触碰旧 `data/projects`。

## 技术栈

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v3 + shadcn/ui（Base UI）
- Vercel AI SDK v7（流式 + 工具调用）
- React Flow（角色关系图谱）
- TanStack Query（新作品台服务器状态）+ React Hook Form / Zod（表单与合同）
- Zustand（仅旧详情的本地交互状态，不镜像新项目数据）
- Node SQLite + Drizzle（新切片）与本地文件存储 JSON / Markdown（旧详情）并存

## 脚本

```bash
npm run dev      # 开发
npm run build    # 生产构建
npm run lint     # 代码检查
npm run typecheck # TypeScript 类型检查
npm test                  # 完整 Vitest 回归
npm run test:unit         # 领域与架构测试
npm run test:integration  # 应用与 SQLite 集成测试
npm run test:component    # jsdom 组件测试
npm run test:e2e          # 隔离数据/构建；失败诊断保存在 .playwright-e2e
npm run db:migrate        # 应用已生成的 SQLite SQL 迁移
npm run db:backup -- <path> # 创建一致性 SQLite 备份
npm run db:restore -- <path> # 原子恢复 SQLite（先停止应用）
```

## 工作原理

AI 在对话中通过 **function calling** 调用工具（`upsert_character` / `delete_character` / `upsert_relationship` / `upsert_world_section` / `upsert_plot_note` / `delete_plot_note` / `create_chapter_outline` / `list_relationship_types`），在自然交流的同时把设定写入资料库——而非让 AI 输出 JSON 文本再解析。章节正文生成使用独立的 NDJSON 事件流端点，注入世界观、角色、前文作为上下文；客户端只在收到完整结束事件后提交正文。
