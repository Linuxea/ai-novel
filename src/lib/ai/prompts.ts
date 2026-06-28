/** 构建系统提示词：注入当前项目设定，引导 AI 进行小说协作创作 */
import type { Character, ProjectData } from "@/lib/types";
import {
  PLOT_STATUS_LABEL,
  PLOT_TYPE_META,
  RELATIONSHIP_META,
  WORLD_CATEGORY_LABEL,
} from "@/lib/types";

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 格式化角色摘要（含目标/能力/别名/关系，控制在精简长度） */
function summarizeCharacters(
  characters: Character[],
  nameById: Map<string, string>,
): string {
  if (!characters.length) return "（暂无角色）";
  return characters
    .map((c) => {
      const parts: string[] = [];
      const head = c.aliases?.length
        ? `- ${c.name}（${c.role}，又名 ${c.aliases.join("、")}）`
        : `- ${c.name}（${c.role}）`;
      const detail: string[] = [];
      if (c.personality) detail.push(`性格：${c.personality}`);
      if (c.background) detail.push(`背景：${c.background}`);
      if (c.goals) detail.push(`目标：${c.goals}`);
      if (c.abilities) detail.push(`能力：${c.abilities}`);
      if (detail.length) parts.push(`${head}：${detail.join("；")}`);
      else parts.push(head);

      const rels = (c.relationships ?? []).flatMap((r) => {
        const targetName = nameById.get(r.targetId);
        if (!targetName) return [];
        const meta = RELATIONSHIP_META[r.type];
        const label = meta ? meta.label : r.type;
        return [`与「${targetName}」${label}`];
      });
      if (rels.length) parts.push(`关系：${rels.join("、")}`);
      return parts.join(" | ");
    })
    .join("\n");
}

/** 格式化剧情规划摘要（未收束项优先、重点呈现） */
function summarizePlot(data: ProjectData): string {
  const notes = data.plotNotes;
  if (!notes.length) return "（暂无剧情规划）";
  const order: Record<string, number> = {
    active: 0,
    idea: 1,
    resolved: 2,
  };
  const sorted = [...notes].sort((a, b) => order[a.status] - order[b.status]);
  return sorted
    .map((p) => {
      const typeLabel = PLOT_TYPE_META[p.type]?.label ?? p.type;
      const statusLabel = PLOT_STATUS_LABEL[p.status];
      const mark = p.status === "resolved" ? "✓" : p.status === "active" ? "▸" : "○";
      return `- ${mark} [${typeLabel}·${statusLabel}] ${p.title}：${truncate(
        p.content,
        100,
      )}`;
    })
    .join("\n");
}

export function buildSystemPrompt(data: ProjectData): string {
  const { project, characters, worldbuilding, chapters } = data;

  const nameById = new Map<string, string>(
    characters.map((c) => [c.id, c.name]),
  );

  const charSummary = summarizeCharacters(characters, nameById);

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

  const plotSummary = summarizePlot(data);

  const chapterSummary = chapters.length
    ? chapters
        .map(
          (c) =>
            `- 第${c.order}章《${c.title}》：${truncate(c.outline || "（无大纲）", 60)}`,
        )
        .join("\n")
    : "（暂无章节）";

  const relDesc = Object.entries(RELATIONSHIP_META)
    .map(([k, v]) => `${v.label}(${k})`)
    .join("、");

  const plotTypeDesc = Object.entries(PLOT_TYPE_META)
    .map(([k, v]) => `${v.label}(${k})`)
    .join("、");
  const plotStatusDesc = Object.entries(PLOT_STATUS_LABEL)
    .map(([k, v]) => `${v}(${k})`)
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
## 剧情规划
${plotSummary}
## 章节规划
${chapterSummary}

# 你的职责
1. **主动引导**：通过提问和探讨，帮助作者一步步明确世界观、人物、剧情。不要一次性问太多，每次聚焦一两个点。
2. **沉淀设定**：当对话中产生了具体的人物、世界观条目、角色关系、剧情规划，或确定了一章要写什么时，**主动调用对应工具**把它们保存下来（不必每次都问作者是否要保存，自然地沉淀即可）。保存后在回复里简短说明你记录了什么。
3. **沉淀剧情规划**：当讨论到故事线走向、需要埋设的伏笔、关键转折、后续几章的大致方向时，**主动调用 upsert_plot_note** 保存为剧情规划。这样即使对话被清空，这些长期规划也不会丢失。
4. **分清「剧情规划」与「章节大纲」**：二者职责不同，切勿混用——
   - 剧情规划（upsert_plot_note）记录**跨章的线索与方向**：贯穿多章的故事线、需要后续回收的伏笔（请用 status 标记：埋下后置 active、回收后置 resolved）、关键转折、整体走向。
   - 章节大纲（create_chapter_outline）记录**某一章具体写什么**：该章的核心场景与事件梗概。
   - 简言之：规划是「方向与伏笔」，章节大纲是「这一章的内容」。两者互补而非替代。
5. **创造性**：给出有想象力、有画面感的建议，而非空泛套话。
6. **一致性**：保持人物性格、世界观规则的连贯；发现矛盾时温和指出。

# 关系类型可选值
${relDesc}

# 世界观分类可选值
${Object.entries(WORLD_CATEGORY_LABEL)
  .map(([k, v]) => `${v}(${k})`)
  .join("、")}

# 剧情规划类型可选值
${plotTypeDesc}

# 剧情规划状态可选值
${plotStatusDesc}

请用流畅自然的中文与作者对话。回复保持适度长度，避免冗长。`;
}
