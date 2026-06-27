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

/** 剧情节点 */
export const PlotPointSchema = z.object({
  id: z.string(),
  act: z.number().describe("所属幕数，从 1 开始"),
  order: z.number().describe("在本幕中的顺序"),
  title: z.string(),
  summary: z.string(),
  characterIds: z.array(z.string()).optional().default([]),
});
export type PlotPoint = z.infer<typeof PlotPointSchema>;

/** 章节 */
export const ChapterStatusSchema = z.enum(["outline", "drafting", "done"]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ChapterSchema = z.object({
  id: z.string(),
  order: z.number(),
  title: z.string(),
  outline: z.string().optional().default(""),
  status: ChapterStatusSchema,
  wordCount: z.number().optional().default(0),
  updatedAt: z.string().optional(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

/** 项目 */
export const ProjectStatusSchema = z.enum(["drafting", "writing", "completed"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string().describe("题材，如 玄幻/科幻/言情/悬疑"),
  summary: z.string(),
  status: ProjectStatusSchema,
  aiModel: z.string().optional().default(""),
  temperature: z.number().optional().default(0.8),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** 对话消息 */
export const ChatRoleSchema = z.enum(["user", "assistant", "tool", "system"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

/** 项目数据聚合（除章节正文） */
export interface ProjectData {
  project: Project;
  worldbuilding: WorldSection[];
  characters: Character[];
  plot: PlotPoint[];
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

export const UpsertPlotPointInputSchema = PlotPointSchema.omit({
  id: true,
}).extend({
  id: z.string().optional().describe("更新现有节点时传入 id；新建留空"),
});
export type UpsertPlotPointInput = z.infer<typeof UpsertPlotPointInputSchema>;

export const CreateChapterOutlineInputSchema = z.object({
  title: z.string(),
  order: z.number().optional().describe("章节顺序，默认追加到末尾"),
  outline: z.string().describe("本章大纲/梗概"),
});
export type CreateChapterOutlineInput = z.infer<
  typeof CreateChapterOutlineInputSchema
>;
