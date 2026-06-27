import "server-only";
import type { Chapter, ProjectData } from "@/lib/types";

/** 构建章节正文生成的系统提示词 */
export function buildWriterPrompt(
  data: ProjectData,
  chapter: { title: string; outline: string; order: number },
  existingContent: string,
  chapters: Chapter[],
): string {
  const { project, characters, worldbuilding } = data;

  const charBlock = characters.length
    ? characters
        .map(
          (c) =>
            `- ${c.name}（${c.role}）：性格${c.personality || "未知"}${
              c.appearance ? `；外貌：${c.appearance}` : ""
            }`,
        )
        .join("\n")
    : "（暂无角色设定）";

  const worldBlock = worldbuilding.length
    ? worldbuilding
        .map((w) => `- ${w.title}：${w.content}`)
        .join("\n")
    : "（暂无）";

  const prevChapters = chapters
    .filter((c) => c.order < chapter.order)
    .sort((a, b) => a.order - b.order)
    .slice(-3);
  const prevBlock = prevChapters.length
    ? prevChapters
        .map((c) => `第${c.order}章《${c.title}》：${c.outline || "（无大纲）"}`)
        .join("\n")
    : "（本章为开篇）";

  return `你是一位才华横溢的中文小说作家，正在为《${project.title}》撰写正文。

# 作品设定
- 题材：${project.genre}
- 简介：${project.summary || "（无）"}

# 世界观
${worldBlock}

# 角色
${charBlock}

# 前文概要（最近章节）
${prevBlock}

# 当前任务
撰写 第${chapter.order}章《${chapter.title}》。
本章大纲：${chapter.outline || "（无大纲，请根据前文合理展开）"}

# 写作要求
1. 用流畅、有画面感的中文小说笔法，注重场景、动作、对话与心理的平衡。
2. 保持人物性格与说话方式的一致性。
3. 节奏自然，避免说教和流水账。
4. 直接输出正文，不要加章节标题、不要解释、不要任何前言后语。
${
  existingContent.trim()
    ? `5. 以下是已有正文，请**紧接其后续写**，不要重复已有内容：\n\n"""${existingContent.trim().slice(-2000)}"""`
    : ""
}`;
}
