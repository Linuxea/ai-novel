import { z } from "zod";
import {
  NovelProjectSchema,
  ProjectCreateInputSchema,
  ProjectStatusSchema,
  ProjectUpdatePatchSchema,
  ActiveProjectStatusSchema,
} from "../domain/project";

const PositiveVersionSchema = z.number().int().positive().safe();

export const ProjectCreateRequestSchema = ProjectCreateInputSchema;

export const ProjectApiPatchRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("update"),
      expectedVersion: PositiveVersionSchema,
      patch: ProjectUpdatePatchSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("transition"),
      expectedVersion: PositiveVersionSchema,
      status: ActiveProjectStatusSchema,
    })
    .strict(),
]);

export const ProjectApiVersionRequestSchema = z
  .object({
    expectedVersion: PositiveVersionSchema,
  })
  .strict();

export const ProjectApiListQuerySchema = z
  .object({
    genre: z.string().trim().min(1).max(40).optional(),
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    page: z.coerce.number().int().positive().safe().optional().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .safe()
      .optional()
      .default(12),
    search: z.string().trim().min(1).max(200).optional(),
    status: ProjectStatusSchema.optional(),
  })
  .strict();

export const ProjectDetailResponseSchema = z
  .object({
    data: NovelProjectSchema,
  })
  .strict();

export const ProjectListResponseSchema = z
  .object({
    data: z.array(NovelProjectSchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const ProjectApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        causeId: z.string().optional(),
        code: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
        kind: z.enum([
          "validation",
          "not_found",
          "conflict",
          "unauthorized",
          "forbidden",
          "unavailable",
          "internal",
        ]),
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ProjectApiPatchRequest = z.infer<
  typeof ProjectApiPatchRequestSchema
>;
export type ProjectApiVersionRequest = z.infer<
  typeof ProjectApiVersionRequestSchema
>;
