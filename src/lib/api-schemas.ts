import { z } from "zod";
import {
  ChapterStatusSchema,
  PlotStatusSchema,
  PlotTypeSchema,
  ProjectStatusSchema,
  RelationshipTypeSchema,
  WorldCategorySchema,
} from "@/lib/types";

const NonEmptyString = z.string().trim().min(1);

export const CreateProjectSchema = z
  .object({
    title: NonEmptyString,
    genre: z.string().trim().optional(),
    summary: z.string().optional(),
    aiModel: z.string().trim().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();

export const UpdateProjectSchema = z
  .object({
    title: NonEmptyString.optional(),
    genre: z.string().trim().optional(),
    summary: z.string().optional(),
    status: ProjectStatusSchema.optional(),
    aiModel: z.string().trim().optional(),
    temperature: z.number().min(0).max(2).optional(),
    ragMode: z.enum(["off", "bm25", "embed"]).optional(),
    ragTopK: z.number().int().min(1).max(20).optional(),
    generateStrategy: z.enum(["auto", "single", "multi"]).optional(),
    multiStepCritique: z.boolean().optional(),
    multiStepRewrite: z.boolean().optional(),
    autoResolveForeshadow: z.boolean().optional(),
  })
  .strict();

export const CreateCharacterSchema = z
  .object({
    name: NonEmptyString,
    role: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    appearance: z.string().optional(),
    personality: z.string().optional(),
    background: z.string().optional(),
    goals: z.string().optional(),
    abilities: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const UpdateCharacterSchema = CreateCharacterSchema.partial().strict();

export const UpsertRelationshipApiSchema = z
  .object({
    characterId: NonEmptyString,
    targetId: NonEmptyString.optional(),
    targetName: NonEmptyString.optional(),
    type: RelationshipTypeSchema,
    description: z.string().optional(),
  })
  .strict()
  .refine((input) => !!input.targetId || !!input.targetName, {
    message: "targetId / targetName 至少需要一个",
    path: ["targetId"],
  });

export const LayoutPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const CreateWorldSectionSchema = z
  .object({
    category: WorldCategorySchema,
    title: NonEmptyString,
    content: z.string().optional(),
  })
  .strict();

export const UpdateWorldSectionSchema = CreateWorldSectionSchema.partial().strict();

const PlotNoteFields = z.object({
  type: PlotTypeSchema,
  title: NonEmptyString,
  content: z.string().optional(),
  status: PlotStatusSchema.optional(),
  characterIds: z.array(z.string()).optional(),
  expectedPlantChapter: z.number().int().positive().optional(),
  expectedResolveChapter: z.number().int().positive().optional(),
});

const plotNoteChapterRefine = (d: {
  expectedPlantChapter?: number;
  expectedResolveChapter?: number;
}) =>
  !d.expectedPlantChapter ||
  !d.expectedResolveChapter ||
  d.expectedResolveChapter > d.expectedPlantChapter;

export const CreatePlotNoteSchema = PlotNoteFields.strict().refine(
  plotNoteChapterRefine,
  {
    message: "expectedResolveChapter 必须晚于 expectedPlantChapter",
    path: ["expectedResolveChapter"],
  },
);

export const UpdatePlotNoteSchema = PlotNoteFields.partial()
  .strict()
  .refine(plotNoteChapterRefine, {
    message: "expectedResolveChapter 必须晚于 expectedPlantChapter",
    path: ["expectedResolveChapter"],
  });

export const ResolvePlotNoteSchema = z
  .object({ chapterId: NonEmptyString })
  .strict();

export const CreateChapterSchema = z
  .object({
    title: NonEmptyString,
    order: z.number().int().positive().optional(),
    outline: z.string().optional(),
    characterIds: z.array(z.string()).optional(),
    notes: z.string().optional(),
    status: ChapterStatusSchema.optional(),
  })
  .strict();

export const UpdateChapterSchema = z
  .object({
    title: NonEmptyString.optional(),
    outline: z.string().optional(),
    characterIds: z.array(z.string()).optional(),
    notes: z.string().optional(),
    status: ChapterStatusSchema.optional(),
  })
  .strict();

export const SaveChapterContentSchema = z
  .object({
    content: z.string(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const ChapterArtifactRequestSchema = z
  .object({
    expectedContentRevision: z.number().int().nonnegative(),
    force: z.boolean().optional(),
  })
  .strict();

export const SaveChatSchema = z
  .object({ messages: z.array(z.unknown()) })
  .strict();

export const ChatRequestSchema = z
  .object({
    projectId: NonEmptyString,
    messages: z.array(z.unknown()),
    id: z.string().optional(),
    trigger: z.string().optional(),
    messageId: z.string().optional(),
  })
  .strict();

export type CreateProjectRequest = z.input<typeof CreateProjectSchema>;
export type UpdateProjectRequest = z.input<typeof UpdateProjectSchema>;
export type CreateCharacterRequest = z.input<typeof CreateCharacterSchema>;
export type UpdateCharacterRequest = z.input<typeof UpdateCharacterSchema>;
export type UpsertRelationshipRequest = z.input<
  typeof UpsertRelationshipApiSchema
>;
export type LayoutPositionRequest = z.input<typeof LayoutPositionSchema>;
export type CreateWorldSectionRequest = z.input<
  typeof CreateWorldSectionSchema
>;
export type UpdateWorldSectionRequest = z.input<
  typeof UpdateWorldSectionSchema
>;
export type CreatePlotNoteRequest = z.input<typeof CreatePlotNoteSchema>;
export type UpdatePlotNoteRequest = z.input<typeof UpdatePlotNoteSchema>;
export type CreateChapterRequest = z.input<typeof CreateChapterSchema>;
export type UpdateChapterRequest = z.input<typeof UpdateChapterSchema>;
