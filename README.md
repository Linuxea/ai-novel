# 墨章 · AI 小说生成器

与 AI 协作，从零构建你的小说世界：通过对话设定世界观、人物、剧情，AI 自动沉淀到资料库；可视化角色关系图谱；AI 辅助逐章写作。

## 功能

- **AI 对话构建**：多轮对话，AI 主动引导并自动记录世界观 / 人物 / 剧情 / 关系 / 章节大纲（流式输出）
- **角色关系图谱**：交互式节点图（React Flow），可拖拽、缩放，关系按类型配色，位置可保存
- **设定资料库**：角色、世界观（分类）、剧情（按幕）的结构化管理，可浏览编辑
- **章节写作**：基于大纲 + 角色 + 前文的 AI 流式正文生成与续写，Markdown 编辑 / 预览
- **项目管理**：多作品、导入 / 导出（zip）、每项目可覆盖 AI 模型

## 快速开始

### 1. 安装依赖

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

> 模型需支持 **工具调用（function calling）**（V4 已支持）。未配置 `AI_API_KEY` 时对话页会给出友好提示。

### 3. 启动

```bash
npm run dev
```

打开 http://localhost:3000 ，新建一部作品即可开始。

## 数据存储

所有数据保存在项目根的 `data/projects/<id>/` 下（JSON 存结构化设定，Markdown 存章节正文），便于版本管理与手动编辑。

## 技术栈

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v3 + shadcn/ui（Base UI）
- Vercel AI SDK v7（流式 + 工具调用）
- React Flow（角色关系图谱）
- Zustand（客户端状态）
- 本地文件存储（JSON / Markdown）

## 脚本

```bash
npm run dev      # 开发
npm run build    # 生产构建
npm run lint     # 代码检查
```

## 工作原理

AI 在对话中通过 **function calling** 调用工具（`upsert_character` / `upsert_relationship` / `upsert_world_section` / `create_chapter_outline`），在自然交流的同时把设定写入资料库——而非让 AI 输出 JSON 文本再解析。章节正文生成使用独立的流式纯文本端点，注入世界观、角色、前文作为上下文。
