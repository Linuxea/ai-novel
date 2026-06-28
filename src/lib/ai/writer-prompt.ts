import "server-only";
import type { Chapter, Character, ProjectData } from "@/lib/types";
import {
  RELATIONSHIP_META,
  WORLD_CATEGORY_LABEL,
} from "@/lib/types";

/** 单章前文上下文：大纲 + 正文节选 */
export interface PrevChapterContext {
  order: number;
  title: string;
  outline: string;
  /** 该章正文末尾节选（已截断），可为空字符串 */
  contentTail: string;
}

const PREV_CONTENT_TAIL_LIMIT = 1500;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(-n);
}

/** 格式化单个角色（含完整字段与关系） */
function formatCharacter(
  c: Character,
  nameById: Map<string, string>,
): string {
  const parts: string[] = [`- ${c.name}（${c.role}）`];
  const detail: string[] = [];
  if (c.aliases && c.aliases.length) {
    detail.push(`别名/曾用名：${c.aliases.join("、")}`);
  }
  if (c.personality) detail.push(`性格：${c.personality}`);
  if (c.appearance) detail.push(`外貌：${c.appearance}`);
  if (c.background) detail.push(`背景：${c.background}`);
  if (c.goals) detail.push(`目标/动机：${c.goals}`);
  if (c.abilities) detail.push(`能力：${c.abilities}`);
  if (c.notes) detail.push(`备注：${c.notes}`);
  if (detail.length) parts[0] += `：${detail.join("；")}`;

  const rels = (c.relationships ?? []).flatMap((r) => {
    const targetName = nameById.get(r.targetId);
    if (!targetName) return [];
    const meta = RELATIONSHIP_META[r.type];
    const label = meta ? meta.label : r.type;
    const desc = r.description ? `——${r.description}` : "";
    return [`  · 与「${targetName}」是${label}关系${desc}`];
  });
  if (rels.length) parts.push(rels.join("\n"));
  return parts.join("\n");
}

/** 构建章节正文生成的系统提示词 */
export function buildWriterPrompt(
  data: ProjectData,
  chapter: { title: string; outline: string; order: number },
  existingContent: string,
  chapters: Chapter[],
  prevContexts: PrevChapterContext[],
): string {
  const { project, characters, worldbuilding, plot } = data;

  // 角色关系解析所需的 id → name 映射
  const nameById = new Map<string, string>(
    characters.map((c) => [c.id, c.name]),
  );

  const charBlock = characters.length
    ? characters.map((c) => formatCharacter(c, nameById)).join("\n")
    : "（暂无角色设定）";

  const worldBlock = worldbuilding.length
    ? worldbuilding
        .map(
          (w) =>
            `- [${WORLD_CATEGORY_LABEL[w.category] ?? w.category}] ${w.title}：${w.content}`,
        )
        .join("\n")
    : "（暂无）";

  const plotBlock = plot.length
    ? plot
        .slice()
        .sort((a, b) => a.act - b.act || a.order - b.order)
        .map(
          (p) =>
            `- 第${p.act}幕 · ${p.title}：${p.summary || "（无摘要）"}`,
        )
        .join("\n")
    : "（暂无剧情节点）";

  const prevBlock = prevContexts.length
    ? prevContexts
        .map((pc) => {
          const lines = [`第${pc.order}章《${pc.title}》`];
          lines.push(
            `  大纲：${pc.outline || "（无大纲）"}`,
          );
          if (pc.contentTail.trim()) {
            lines.push(`  正文节选（末段）：\n"""\n${pc.contentTail.trim()}\n"""`);
          }
          return lines.join("\n");
        })
        .join("\n\n")
    : "（本章为开篇，无前文）";

  return `你是一位才华横溢的中文小说作家，正在为《${project.title}》撰写正文。

# 作品设定
- 题材：${project.genre}
- 简介：${project.summary || "（无）"}

# 世界观
${worldBlock}

# 角色
${charBlock}

# 整体剧情走向（按幕组织）
${plotBlock}

# 前文（最近章节的大纲与正文节选）
${prevBlock}

# 当前任务
撰写 第${chapter.order}章《${chapter.title}》。
本章大纲：${chapter.outline || "（无大纲，请根据前文与剧情走向合理展开）"}

# 写作要求
1. 用流畅、有画面感的中文小说笔法，注重场景、动作、对话与心理的平衡。
2. 严格遵循「角色」中的人物性格、说话方式、背景、目标与关系；角色之间的互动基调必须与设定一致。
3. 与「前文」中已发生的事件、人物状态、已说过的台词、已出现的物品保持连贯，不得矛盾或重复（例如已死之人不可复活、已交付的信物不可再次出现）。
4. 推进「整体剧情走向」中本章应覆盖的剧情节点，注意埋设与回收伏笔。
5. 节奏自然，避免说教和流水账。
6. 直接输出正文，不要加章节标题、不要解释、不要任何前言后语。
${
  existingContent.trim()
    ? `\n7. 以下是已有正文，请**紧接其后续写**，不要重复已有内容：\n\n"""${truncate(existingContent.trim(), 2000)}"""`
    : ""
}`;
}

export { PREV_CONTENT_TAIL_LIMIT };
