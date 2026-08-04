import "server-only";
import type { Chapter, Project } from "@/lib/types";

const SUMMARY_MIN = 200;
const SUMMARY_MAX = 300;

/** 注入 writer prompt 的"前情提要"条目（仅 order < 当前章 的章节） */
export interface PriorSummary {
  order: number;
  title: string;
  summary: string;
}

/** 前情提要块的字符预算：超出则只保留最近若干章的摘要 */
const SUMMARY_BLOCK_CHAR_BUDGET = 6000;

/**
 * 把若干 PriorSummary 渲染成"前情提要"段落。
 * 按章节顺序排列；若总长超预算，仅保留最近的若干章（贪心从最近向前填）。
 */
export function renderSummaryBlock(
  summaries: PriorSummary[],
  charBudget = SUMMARY_BLOCK_CHAR_BUDGET,
): string {
  const valid = summaries
    .filter((s) => s.summary && s.summary.trim().length > 0)
    .sort((a, b) => a.order - b.order);
  if (valid.length === 0) return "";

  // 贪心：从最近的向前填，直到超出预算
  const kept: PriorSummary[] = [];
  let used = 0;
  for (let i = valid.length - 1; i >= 0; i--) {
    const s = valid[i];
    const cost = `第${s.order}章《${s.title}》：${s.summary}`.length + 1;
    if (used + cost > charBudget && kept.length > 0) break;
    kept.unshift(s);
    used += cost;
  }

  return kept
    .map((s) => `- 第${s.order}章《${s.title}》：${s.summary}`)
    .join("\n");
}

/** 构建章节摘要生成的系统提示词 */
export function buildChapterSummaryPrompt(
  project: Pick<Project, "title" | "genre">,
  chapter: Pick<Chapter, "order" | "title" | "outline">,
): string {
  return `你是资深小说编辑。请为《${project.title}》（${project.genre}）第${chapter.order}章《${chapter.title}》撰写一段正文摘要。

# 要求
1. 客观概括本章正文中实际发生的事件（不是规划要写什么）：核心冲突、关键转折、主要人物的行动与决定、关系变化。
2. 字数严格控制在 ${SUMMARY_MIN}-${SUMMARY_MAX} 字。
3. 必须忠实于正文，不得臆造、不得补足、不得评价。
4. 重点关注后续章节需要"记住"的信息：新登场的人物/物品/地点、人物状态变化、未解之谜、已说出的关键台词要点。
5. 只输出摘要正文，不要标题、编号、引号、"摘要："等任何前后缀。`;
}

export { SUMMARY_MIN, SUMMARY_MAX };
