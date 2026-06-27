/** 构建系统提示词：注入当前项目设定，引导 AI 进行小说协作创作 */
import type { ProjectData } from "@/lib/types";
import { RELATIONSHIP_META, WORLD_CATEGORY_LABEL } from "@/lib/types";

export function buildSystemPrompt(data: ProjectData): string {
  const { project, characters, worldbuilding, plot, chapters } = data;

  const charSummary = characters.length
    ? characters
        .map(
          (c) =>
            `- ${c.name}（${c.role}）：${
              c.personality || c.background || "（待补充）"
            }`,
        )
        .join("\n")
    : "（暂无角色）";

  const worldSummary = worldbuilding.length
    ? worldbuilding
        .map(
          (w) =>
            `- [${WORLD_CATEGORY_LABEL[w.category]}] ${w.title}：${truncate(
              w.content,
              80,
            )}`,
        )
        .join("\n")
    : "（暂无世界观）";

  const plotSummary = plot.length
    ? plot
        .map((p) => `- 第${p.act}幕 · ${p.title}：${truncate(p.summary, 60)}`)
        .join("\n")
    : "（暂无剧情）";

  const chapterSummary = chapters.length
    ? `共 ${chapters.length} 章`
    : "（暂无章节）";

  const relDesc = Object.entries(RELATIONSHIP_META)
    .map(([k, v]) => `${v.label}(${k})`)
    .join("、");

  return `你是一位经验丰富的中文小说创作顾问「墨章」，正在协助作者构建一部小说。

# 当前作品
- 书名：《${project.title}》
- 题材：${project.genre}
- 简介：${project.summary || "（尚未设定）"}

# 已有设定
## 角色
${charSummary}
## 世界观
${worldSummary}
## 剧情大纲
${plotSummary}
## 章节：${chapterSummary}

# 你的职责
1. **主动引导**：通过提问和探讨，帮助作者一步步明确世界观、人物、剧情。不要一次性问太多，每次聚焦一两个点。
2. **沉淀设定**：当对话中产生了具体的人物、世界观条目、剧情节点、角色关系或章节大纲时，**主动调用对应工具**把它们保存下来（不必每次都问作者是否要保存，自然地沉淀即可）。保存后在回复里简短说明你记录了什么。
3. **创造性**：给出有想象力、有画面感的建议，而非空泛套话。
4. **一致性**：保持人物性格、世界观规则的连贯；发现矛盾时温和指出。

# 关系类型可选值
${relDesc}

# 世界观分类可选值
${Object.entries(WORLD_CATEGORY_LABEL)
  .map(([k, v]) => `${v}(${k})`)
  .join("、")}

请用流畅自然的中文与作者对话。回复保持适度长度，避免冗长。`;
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
