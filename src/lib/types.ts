import { z } from "zod";

/** 关系类型 */
export const RelationshipTypeSchema = z.enum([
  "family",
  "friend",
  "lover",
  "mentor",
  "rival",
  "enemy",
  "ally",
  "other",
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RELATIONSHIP_META: Record<
  RelationshipType,
  { label: string; color: string; description: string }
> = {
  family: { label: "亲人", color: "#3b82f6", description: "血缘或亲属关系" },
  friend: { label: "朋友", color: "#22c55e", description: "友谊" },
  lover: { label: "恋人", color: "#ec4899", description: "恋爱关系" },
  mentor: { label: "师徒", color: "#a855f7", description: "教导/指引关系" },
  rival: { label: "竞争对手", color: "#f59e0b", description: "竞争关系" },
  enemy: { label: "敌对", color: "#ef4444", description: "敌对关系" },
  ally: { label: "盟友", color: "#06b6d4", description: "合作关系" },
  other: { label: "其他", color: "#64748b", description: "其他关系" },
};

/** 关系 */
export const RelationshipSchema = z.object({
  id: z.string(),
  targetId: z.string().describe("关系指向的角色 id"),
  type: RelationshipTypeSchema,
  description: z.string().optional().default(""),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

/** 角色 */
export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().describe("角色定位，如 主角/反派/配角"),
  aliases: z.array(z.string()).optional().default([]),
  appearance: z.string().optional().default(""),
  personality: z.string().optional().default(""),
  background: z.string().optional().default(""),
  goals: z.string().optional().default(""),
  abilities: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  layoutPosition: z
    .object({ x: z.number(), y: z.number() })
    .optional()
    .nullable(),
  relationships: z.array(RelationshipSchema).optional().default([]),
});
export type Character = z.infer<typeof CharacterSchema>;

/** 世界观条目 */
export const WorldCategorySchema = z.enum([
  "geography",
  "history",
  "faction",
  "magic",
  "culture",
  "technology",
  "other",
]);
export type WorldCategory = z.infer<typeof WorldCategorySchema>;

export const WORLD_CATEGORY_LABEL: Record<WorldCategory, string> = {
  geography: "地理",
  history: "历史",
  faction: "势力",
  magic: "魔法/力量体系",
  culture: "文化风俗",
  technology: "科技",
  other: "其他",
};

export const WorldSectionSchema = z.object({
  id: z.string(),
  category: WorldCategorySchema,
  title: z.string(),
  content: z.string(),
  updatedAt: z.string(),
});
export type WorldSection = z.infer<typeof WorldSectionSchema>;

/** 章节 */
export const ChapterStatusSchema = z.enum(["outline", "drafting", "done"]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ChapterSchema = z.object({
  id: z.string(),
  order: z.number(),
  title: z.string(),
  outline: z.string().optional().default(""),
  characterIds: z.array(z.string()).optional().default([]),
  notes: z.string().optional().default(""),
  status: ChapterStatusSchema,
  wordCount: z.number().optional().default(0),
  updatedAt: z.string().optional(),
  contentHash: z.string().optional().default(""),
  contentRevision: z.number().int().nonnegative().optional().default(0),
  summary: z.string().optional().default(""),
  summaryOfContentHash: z.string().optional().default(""),
  summaryInputFingerprint: z.string().optional().default(""),
  summaryPromptVersion: z.number().int().positive().optional().default(1),
  summaryGeneratedAt: z.string().optional(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

/** 剧情规划类型 */
export const PlotTypeSchema = z.enum([
  "arc",
  "foreshadow",
  "twist",
  "plan",
  "note",
]);
export type PlotType = z.infer<typeof PlotTypeSchema>;

export const PLOT_TYPE_META: Record<PlotType, { label: string; description: string }> = {
  arc: { label: "故事线", description: "贯穿多章的主线/支线脉络" },
  foreshadow: { label: "伏笔", description: "需要后续回收的铺垫" },
  twist: { label: "转折", description: "关键剧情转折点" },
  plan: { label: "后续走向", description: "接下来的大致方向" },
  note: { label: "备忘", description: "其他创作备忘" },
};

/** 剧情规划状态 */
export const PlotStatusSchema = z.enum(["idea", "active", "resolved"]);
export type PlotStatus = z.infer<typeof PlotStatusSchema>;

export const PLOT_STATUS_LABEL: Record<PlotStatus, string> = {
  idea: "构想中",
  active: "进行中",
  resolved: "已收束",
};

/** 剧情规划条目（区别于章节大纲：规划是跨章的线索与方向） */
export const PlotNoteSchema = z.object({
  id: z.string(),
  type: PlotTypeSchema,
  title: z.string(),
  content: z.string(),
  status: PlotStatusSchema,
  characterIds: z.array(z.string()).optional().default([]),
  expectedPlantChapter: z.number().int().positive().optional(),
  expectedResolveChapter: z.number().int().positive().optional(),
  plantedInChapter: z.number().int().positive().optional(),
  resolvedInChapter: z.number().int().positive().optional(),
  updatedAt: z.string(),
});
export type PlotNote = z.infer<typeof PlotNoteSchema>;

/** 项目 */
export const ProjectStatusSchema = z.enum(["drafting", "writing", "completed"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export const CURRENT_PROJECT_SCHEMA_VERSION = 1 as const;

export const ProjectSchema = z.object({
  schemaVersion: z
    .literal(CURRENT_PROJECT_SCHEMA_VERSION)
    .optional()
    .default(CURRENT_PROJECT_SCHEMA_VERSION),
  id: z.string(),
  title: z.string(),
  genre: z.string().describe("题材，如 玄幻/科幻/言情/悬疑"),
  summary: z.string(),
  status: ProjectStatusSchema,
  aiModel: z.string().optional().default(""),
  temperature: z.number().optional().default(0.8),
  ragMode: z.enum(["off", "bm25", "embed"]).optional().default("off"),
  ragTopK: z.number().int().min(1).max(20).optional().default(6),
  generateStrategy: z
    .enum(["auto", "single", "multi"])
    .optional()
    .default("auto"),
  multiStepCritique: z.boolean().optional().default(true),
  multiStepRewrite: z.boolean().optional().default(false),
  autoResolveForeshadow: z.boolean().optional().default(false),
  revision: z.number().int().nonnegative().optional().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** 对话消息 */
export const ChatRoleSchema = z.enum(["user", "assistant", "tool", "system"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

/** 聊天历史持久化与注入模型的条数上限（超出后仅保留最近 N 条） */
export const CHAT_HISTORY_LIMIT = 200;

/** 项目数据聚合（除章节正文） */
export interface ProjectData {
  project: Project;
  worldbuilding: WorldSection[];
  characters: Character[];
  plotNotes: PlotNote[];
  chapters: Chapter[];
}

/** AI 工具入参 schema（供 tools.ts 复用） */
export const UpsertCharacterInputSchema = z.object({
  id: z.string().optional().describe("更新现有角色时传入其 id；新建则留空"),
  name: z.string(),
  role: z.string().optional().describe("角色定位，如 主角/反派/配角"),
  aliases: z.array(z.string()).optional(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  background: z.string().optional(),
  goals: z.string().optional(),
  abilities: z.string().optional(),
  notes: z.string().optional(),
});
export type UpsertCharacterInput = z.infer<typeof UpsertCharacterInputSchema>;

export const UpsertRelationshipInputSchema = z.object({
  characterId: z.string().describe("关系发起方角色 id"),
  targetName: z
    .string()
    .describe("关系目标角色名称（会自动匹配已存在角色）"),
  type: RelationshipTypeSchema,
  description: z.string().optional().default(""),
});
export type UpsertRelationshipInput = z.infer<
  typeof UpsertRelationshipInputSchema
>;

export const UpsertWorldSectionInputSchema = WorldSectionSchema.omit({
  id: true,
  updatedAt: true,
}).extend({
  id: z.string().optional().describe("更新现有条目时传入 id；新建留空"),
});
export type UpsertWorldSectionInput = z.infer<
  typeof UpsertWorldSectionInputSchema
>;

export const CreateChapterOutlineInputSchema = z.object({
  title: z.string(),
  order: z.number().optional().describe("章节顺序，默认追加到末尾"),
  outline: z.string().describe("本章大纲/梗概"),
  characterIds: z
    .array(z.string())
    .optional()
    .describe("本章涉及的角色 id（可选）"),
  notes: z.string().optional().describe("作者备注，如\"待扩写\"（可选）"),
});
export type CreateChapterOutlineInput = z.infer<
  typeof CreateChapterOutlineInputSchema
>;

export const UpsertPlotNoteInputSchema = z
  .object({
    id: z.string().optional().describe("更新现有条目时传入 id；新建留空"),
    type: PlotTypeSchema.describe(
      "arc故事线/foreshadow伏笔/twist转折/plan后续走向/note备忘",
    ),
    title: z.string(),
    content: z.string().optional().describe("详细说明（可留空后补）"),
    status: PlotStatusSchema.optional().describe("默认 idea 构想中"),
    characterIds: z.array(z.string()).optional().describe("关联角色 id（可选）"),
    expectedPlantChapter: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("计划在第几章埋下（主要针对伏笔；章序号，如 5 表示第5章）"),
    expectedResolveChapter: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("计划在第几章回收/揭晓（主要针对伏笔；章序号）"),
  })
  .refine(
    (d) =>
      !d.expectedPlantChapter ||
      !d.expectedResolveChapter ||
      d.expectedResolveChapter > d.expectedPlantChapter,
    {
      message: "expectedResolveChapter 必须晚于 expectedPlantChapter",
      path: ["expectedResolveChapter"],
    },
  );
export type UpsertPlotNoteInput = z.infer<typeof UpsertPlotNoteInputSchema>;

/** ===== 一致性检查 ===== */
export const FindingSeveritySchema = z.enum(["high", "medium", "low"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingCategorySchema = z.enum([
  "character",
  "worldview",
  "foreshadow",
  "timeline",
  "repetition",
  "logic",
  "other",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FINDING_CATEGORY_META: Record<
  FindingCategory,
  { label: string; color: string }
> = {
  character: { label: "人物矛盾", color: "#ef4444" },
  worldview: { label: "世界观违反", color: "#f59e0b" },
  foreshadow: { label: "伏笔问题", color: "#a855f7" },
  timeline: { label: "时间线", color: "#3b82f6" },
  repetition: { label: "重复", color: "#64748b" },
  logic: { label: "逻辑硬伤", color: "#ec4899" },
  other: { label: "其他", color: "#6b7280" },
};

export const SEVERITY_META: Record<
  FindingSeverity,
  { label: string; color: string }
> = {
  high: { label: "高", color: "#ef4444" },
  medium: { label: "中", color: "#f59e0b" },
  low: { label: "低", color: "#64748b" },
};

export const ConsistencyFindingSchema = z.object({
  severity: FindingSeveritySchema,
  category: FindingCategorySchema,
  message: z.string().describe("问题简述，一两句，含具体角色/事件名"),
  evidence: z
    .string()
    .optional()
    .describe("正文中能佐证该问题的原文片段，尽量逐字引用"),
  location: z.string().optional().describe("问题所在位置，如「开篇第三段」"),
  relatedPlotNoteId: z
    .string()
    .optional()
    .describe("若与某条 PlotNote 直接相关，填其 id"),
  suggestedAction: z.string().optional().describe("一句话修改建议"),
});
export type ConsistencyFinding = z.infer<typeof ConsistencyFindingSchema>;

export const ForeshadowResolutionSchema = z.object({
  plotNoteId: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().describe("为何判定已回收，引用正文片段"),
});
export type ForeshadowResolution = z.infer<typeof ForeshadowResolutionSchema>;

/** 模型产出（generateObject 的 schema） */
export const ConsistencyCheckOutputSchema = z.object({
  summary: z.string().describe("一句话总评，如「未发现明显问题」"),
  findings: z.array(ConsistencyFindingSchema).max(8),
  foreshadowResolutions: z.array(ForeshadowResolutionSchema),
});
export type ConsistencyCheckOutput = z.infer<
  typeof ConsistencyCheckOutputSchema
>;

/** 持久化报告 = 模型产出 + 服务端元数据 */
export const ConsistencyReportSchema = ConsistencyCheckOutputSchema.extend({
  chapterId: z.string(),
  checkedAt: z.string(),
  contentHash: z.string(),
  contentRevision: z.number().int().nonnegative().optional().default(0),
  projectRevision: z.number().int().nonnegative().optional().default(0),
  committedProjectRevision: z.number().int().nonnegative().optional().default(0),
  inputFingerprint: z.string().optional().default(""),
  promptVersion: z.number().int().positive().optional().default(1),
  error: z.string().optional(),
});
export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

/** ===== 多步生成：beat 分镜 ===== */
export const BeatSchema = z.object({
  index: z.number().describe("1-based 序号"),
  summary: z.string().describe("本 beat 发生什么，1-2 句"),
  targetWords: z.number().int().min(100).max(1500),
  pov: z.string().optional().describe("视角角色名"),
  mood: z.string().optional().describe("情绪基调"),
  characterIds: z.array(z.string()).optional(),
  plotHooks: z
    .array(z.string())
    .optional()
    .describe("本 beat 要埋/收的伏笔标题"),
});
export type Beat = z.infer<typeof BeatSchema>;

export const BeatSheetSchema = z.object({
  beats: z.array(BeatSchema).min(2).max(10),
  overallArc: z.string().describe("本章情绪/情节弧线一句话"),
});
export type BeatSheet = z.infer<typeof BeatSheetSchema>;

export const BEAT_SHEET_CACHE_VERSION = 1;
export const BeatSheetCacheSchema = z.object({
  version: z.literal(BEAT_SHEET_CACHE_VERSION),
  mode: z.enum(["continue", "regenerate"]),
  baseContentHash: z.string(),
  outlineHash: z.string(),
  contentRevision: z.number().int().nonnegative(),
  projectRevision: z.number().int().nonnegative(),
  modelId: z.string(),
  createdAt: z.string(),
  sheet: BeatSheetSchema,
});
export type BeatSheetCache = z.infer<typeof BeatSheetCacheSchema>;
