import "server-only";
import { generateObject } from "ai";
import { getModel } from "@/lib/ai/client";
import {
  ConsistencyCheckOutputSchema,
  type Character,
  type Chapter,
  type ConsistencyReport,
  type PlotNote,
  type ProjectData,
} from "@/lib/types";
import {
  getProjectData,
  hashContent,
  readChapterContent,
  saveCheck,
  updatePlotNote,
  now,
} from "@/lib/storage";
import { classifyDuePlotNotes } from "@/lib/plot-due";

/** 截断到上限；超长则取头尾，中间标注省略字数 */
function cap(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 20) return s.slice(0, max);
  const head = Math.floor(max * 0.7);
  const tail = Math.floor(max * 0.25);
  return (
    s.slice(0, head) +
    `\n…（已截断 ${s.length - head - tail} 字）…\n` +
    s.slice(-tail)
  );
}

function formatChar(c: Character): string {
  const parts = [`- ${c.name}（${c.role}）`];
  const detail: string[] = [];
  if (c.personality) detail.push(`性格：${c.personality}`);
  if (c.background) detail.push(`背景：${c.background}`);
  if (c.goals) detail.push(`目标：${c.goals}`);
  if (c.abilities) detail.push(`能力：${c.abilities}`);
  if (detail.length) parts[0] += `：${detail.join("；")}`;
  return parts.join("\n");
}

interface CheckContext {
  project: ProjectData["project"];
  chapter: Chapter;
  newContent: string;
  involvedCharacters: Character[];
  worldbuilding: ProjectData["worldbuilding"];
  dueForeshadows: PlotNote[];
  activeArcs: PlotNote[];
  prevLines: string[];
}

function gatherCheckContext(
  data: ProjectData,
  chapter: Chapter,
  content: string,
): CheckContext {
  const charIds = new Set(chapter.characterIds ?? []);
  const involvedCharacters = data.characters.filter(
    (c) =>
      charIds.has(c.id) ||
      [c.name, ...(c.aliases ?? [])].some(
        (n) => n && n.length > 0 && content.includes(n),
      ),
  );

  const due = classifyDuePlotNotes(data.plotNotes, chapter.order);
  const dueForeshadows = [...due.mustResolve, ...due.mustPlant];
  const activeArcs = data.plotNotes.filter(
    (p) =>
      p.status !== "resolved" &&
      p.type !== "foreshadow" &&
      p.type !== "note",
  );

  const prevChapters = data.chapters
    .filter((c) => c.order < chapter.order)
    .sort((a, b) => a.order - b.order)
    .slice(-6);
  const prevLines = prevChapters.map((c) => {
    const body = c.summary?.trim() || c.outline?.trim() || "（无）";
    return `- 第${c.order}章《${c.title}》：${body}`;
  });

  return {
    project: data.project,
    chapter,
    newContent: content,
    involvedCharacters,
    worldbuilding: data.worldbuilding,
    dueForeshadows,
    activeArcs,
    prevLines,
  };
}

function buildConsistencyCheckPrompt(ctx: CheckContext): {
  system: string;
  prompt: string;
} {
  const { project, chapter, dueForeshadows } = ctx;

  const system = `你是一位严谨的小说连贯性审校编辑，审查《${project.title}》（${project.genre}）第${chapter.order}章《${chapter.title}》的正文。

# 审查原则（务必遵守）
1. 只报告【确凿】的问题——宁可漏报不可误报。文风、措辞、节奏偏好不是问题。
2. 每条 finding 必须在 evidence 中给出正文中能佐证的原文片段（尽量逐字引用，不超过两句）。引不出证据的不要报。
3. 同一个矛盾点只报一次，合并成一条；不要把一件事拆成多条凑数。
4. severity 判定：
   - high：硬冲突（已死角色复活 / 已交付信物再现 / 与角色核心设定冲突 / 与世界观铁律冲突）
   - medium：明显连贯性问题（时间线错乱 / 伏笔前后不一致 / 重大重复）
   - low：轻微疑点——除非确凿否则不上报，优先省略
5. foreshadowResolutions：仅当正文【明确且完整】兑现了某伏笔时才提出；擦边、半回收不要提。
6. findings 上限 8 条；本章无问题则 findings=[]，summary 写"未发现明显问题"。

# category 释义
- character：人物矛盾（性格/背景/能力/关系/状态与设定冲突）
- worldview：世界观违反
- foreshadow：伏笔遗漏 / 错误回收 / 前后不一致
- timeline：时间线错乱
- repetition：与前文明显重复（已发生的事 / 已说过的台词 / 已出现的物品）
- logic：情节逻辑硬伤
- other：其他

# 待回收/到期伏笔清单（重点核对这些是否被正文推翻或错误回收）
${dueForeshadows.length ? dueForeshadows.map((p) => `- 《${p.title}》：${p.content || "（无详情）"}`).join("\n") : "（本章无强制到期的伏笔）"}

请严格按 schema 输出，message 用中文，简明具体（点名道姓、点事件）。`;

  const charBlock = ctx.involvedCharacters.length
    ? ctx.involvedCharacters.map(formatChar).join("\n")
    : "（本章未涉及已设定角色）";

  const worldBlock = ctx.worldbuilding.length
    ? ctx.worldbuilding
        .map((w) => `- [${w.category}] ${w.title}：${w.content}`)
        .join("\n")
    : "（暂无）";

  const arcBlock = ctx.activeArcs.length
    ? ctx.activeArcs
        .map((p) => `- [${p.type}] ${p.title}：${p.content || "（无）"}`)
        .join("\n")
    : "（暂无）";

  const prevBlock = ctx.prevLines.length
    ? ctx.prevLines.join("\n")
    : "（本章为开篇，无前文）";

  const prompt = `# 本章角色（设定参照）
${cap(charBlock, 3000)}

# 世界观（设定参照）
${cap(worldBlock, 2000)}

# 活跃剧情线（参照）
${cap(arcBlock, 2000)}

# 前文（最近章节的摘要或大纲）
${cap(prevBlock, 1500)}

# 本章正文（待审查）
${cap(ctx.newContent, 8000)}`;

  return { system, prompt };
}

/** 运行一致性检查。失败时落一份 error 报告，绝不抛出。 */
export async function runConsistencyCheck(
  projectId: string,
  chapterId: string,
): Promise<ConsistencyReport> {
  const data = await getProjectData(projectId);
  if (!data) throw new Error("项目不存在");
  const chapter = data.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error("章节不存在");
  const content = await readChapterContent(projectId, chapterId);
  const contentHash = hashContent(content);

  const empty: ConsistencyReport = {
    summary: "正文为空，跳过检查",
    findings: [],
    foreshadowResolutions: [],
    chapterId,
    checkedAt: now(),
    contentHash,
  };
  if (!content.trim()) {
    await saveCheck(projectId, chapterId, empty);
    return empty;
  }

  const ctx = gatherCheckContext(data, chapter, content);
  const { system, prompt } = buildConsistencyCheckPrompt(ctx);

  try {
    const { object } = await generateObject({
      model: getModel(data.project.aiModel || undefined),
      schema: ConsistencyCheckOutputSchema,
      system,
      prompt,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(45_000),
    });

    const report: ConsistencyReport = {
      ...object,
      chapterId,
      checkedAt: now(),
      contentHash,
    };
    await saveCheck(projectId, chapterId, report);

    // 伏笔回填：仅在开启自动回收且高置信度时推进状态，否则仅作为建议（UI 人工确认）
    if (data.project.autoResolveForeshadow) {
      for (const res of object.foreshadowResolutions) {
        if (res.confidence !== "high") continue;
        try {
          await updatePlotNote(projectId, res.plotNoteId, {
            resolvedInChapter: chapter.order,
            status: "resolved",
          });
        } catch {
          // 单条回填失败不影响其余
        }
      }
    }

    return report;
  } catch (e) {
    const errReport: ConsistencyReport = {
      summary: "检查失败",
      findings: [],
      foreshadowResolutions: [],
      chapterId,
      checkedAt: now(),
      contentHash,
      error: (e as Error).message,
    };
    await saveCheck(projectId, chapterId, errReport);
    return errReport;
  }
}
