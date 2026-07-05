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

export const CreatePlotNoteSchema = z
  .object({
    type: PlotTypeSchema,
    title: NonEmptyString,
    content: z.string().optional(),
    status: PlotStatusSchema.optional(),
    characterIds: z.array(z.string()).optional(),
  })
  .strict();

export const UpdatePlotNoteSchema = CreatePlotNoteSchema.partial().strict();

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
    order: z.number().int().positive().optional(),
    outline: z.string().optional(),
    characterIds: z.array(z.string()).optional(),
    notes: z.string().optional(),
    status: ChapterStatusSchema.optional(),
    wordCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const SaveChapterContentSchema = z
  .object({ content: z.string() })
  .strict();

export const SaveChatSchema = z
  .object({ messages: z.array(z.unknown()).max(200) })
  .strict();

export const ChatRequestSchema = z
  .object({
    projectId: NonEmptyString,
    messages: z.array(z.unknown()).max(200),
  })
  .strict();
