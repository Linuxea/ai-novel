import "server-only";
import type { Chapter, Character, Project, ProjectData } from "@/lib/types";
import {
  PLOT_STATUS_LABEL,
  PLOT_TYPE_META,
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
  const { project, characters, worldbuilding, plotNotes } = data;

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

  const arcBlock = chapters.length
    ? chapters
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(
          (c) => `- 第${c.order}章《${c.title}》：${c.outline || "（无大纲）"}`,
        )
        .join("\n")
    : "（暂无已规划章节）";

  const pendingPlot = (plotNotes ?? []).filter((p) => p.status !== "resolved");
  const resolvedPlot = (plotNotes ?? []).filter((p) => p.status === "resolved");
  const plotBlock = pendingPlot.length
    ? pendingPlot
        .map((p) => {
          const typeLabel = PLOT_TYPE_META[p.type]?.label ?? p.type;
          const statusLabel = PLOT_STATUS_LABEL[p.status];
          return `- [${typeLabel}·${statusLabel}] ${p.title}：${p.content || "（无详情）"}`;
        })
        .join("\n")
    : "";
  const resolvedHint = resolvedPlot.length
    ? `\n（已收束、无需再埋：${resolvedPlot
        .map((p) => p.title)
        .join("、")}）`
    : "";

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

# 已规划章节（整体走向）
${arcBlock}

# 剧情规划（写作参照：留意埋设与回收）
${plotBlock || "（暂无待埋/待收的剧情线）"}${resolvedHint}

# 前文（最近章节的大纲与正文节选）
${prevBlock}

# 当前任务
撰写 第${chapter.order}章《${chapter.title}》。
本章大纲：${chapter.outline || "（无大纲，请根据前文与已规划章节合理展开）"}

# 写作要求
1. 用流畅、有画面感的中文小说笔法，注重场景、动作、对话与心理的平衡。
2. 严格遵循「角色」中的人物性格、说话方式、背景、目标与关系；角色之间的互动基调必须与设定一致。
3. 与「前文」中已发生的事件、人物状态、已说过的台词、已出现的物品保持连贯，不得矛盾或重复（例如已死之人不可复活、已交付的信物不可再次出现）。
4. 推进「本章大纲」中规划的内容，注意埋设与回收伏笔。参照「剧情规划」中标记为构想中/进行中的伏笔与故事线自然地埋设铺垫；不要重复「已收束」的线索。
5. 节奏自然，避免说教和流水账。
6. 直接输出正文，不要加章节标题、不要解释、不要任何前言后语。
${
  existingContent.trim()
    ? `\n7. 以下是已有正文，请**紧接其后续写**，不要重复已有内容：\n\n"""${truncate(existingContent.trim(), 2000)}"""`
    : ""
}`;
}

export { PREV_CONTENT_TAIL_LIMIT };

/**
 * 构建「同步大纲」的提示词：以原有大纲为基底、结合正文实际内容重写大纲。
 * 同时接收原有大纲与正文（由调用方拼装为带标签的 prompt），此函数仅产出指令（system）。
 */
export function buildOutlineSyncPrompt(
  project: Pick<Project, "title" | "genre">,
  chapter: Pick<Chapter, "order" | "title">,
  existingOutline: string,
): string {
  const hasOutline = !!existingOutline.trim();
  return `你是一位资深小说编辑，正在为《${project.title}》（${project.genre}）整理第${chapter.order}章《${chapter.title}》的大纲。

# 任务
你将收到【原有大纲】与【本章正文】两部分。请${
      hasOutline
        ? "以【原有大纲】为基底，结合【本章正文】的实际内容，重写本章大纲"
        : "本章尚无大纲，请基于【本章正文】提炼一份完整的大纲"
    }。

${
  hasOutline
    ? `# 处理原则（重要）
1. **最大程度保留原有大纲**：原有大纲中仍然成立、与正文一致的内容，必须原样保留，不得为了简短而删除或合并掉。
2. **冲突以正文为准**：逐条比对，凡正文实际发生的内容与原大纲相抵触之处（情节走向、事件结果、人物行为等），按正文更正。
3. **补充遗漏**：正文里有、但原大纲未提及的关键情节，补充进大纲。
4. **不臆造**：正文里没有发生的情节，绝不新增。`
    : `# 处理原则
1. 基于正文实际内容概括本章发生了什么。
2. 不得臆造或补足正文里没有发生的情节。`
}

# 输出要求
1. 信息要充分，覆盖本章的关键情节（核心事件、转折、人物的关键行动与决定）；详尽程度${
      hasOutline ? "与原大纲相当" : "足以让人了解本章脉络"
    }。
2. 这是"大纲"而非正文逐句复述——抓要点，但**不要为了简短而牺牲信息量**。
3. 只输出大纲文本本身——不要加章节标题、编号、引号、"大纲："等任何前后缀或解释。
4. 用流畅的中文。`;
}


