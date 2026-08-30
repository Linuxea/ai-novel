import { z } from "zod";

const PROJECT_TITLE_MAX_LENGTH = 80;
const PROJECT_SUBTITLE_MAX_LENGTH = 120;
const PROJECT_GENRE_MAX_LENGTH = 40;
const PROJECT_PREMISE_MAX_LENGTH = 2_000;
const PROJECT_TARGET_AUDIENCE_MAX_LENGTH = 200;
const PROJECT_MODEL_ID_MAX_LENGTH = 160;
const PROJECT_TARGET_WORD_COUNT_MIN = 1_000;
const PROJECT_TARGET_WORD_COUNT_MAX = 10_000_000;

export const ProjectIdSchema = z.uuid();

export const ProjectStatusSchema = z.enum([
  "planning",
  "writing",
  "revising",
  "completed",
  "archived",
]);

export const ActiveProjectStatusSchema = z.enum([
  "planning",
  "writing",
  "revising",
  "completed",
]);

const ModelIdSchema = z
  .string()
  .trim()
  .min(1, "模型 ID 不能为空")
  .max(PROJECT_MODEL_ID_MAX_LENGTH, "模型 ID 不能超过 160 个字符");

export const ProjectModelPreferencesSchema = z
  .object({
    chat: ModelIdSchema.nullable().optional().default(null),
    embedding: ModelIdSchema.nullable().optional().default(null),
    review: ModelIdSchema.nullable().optional().default(null),
    writing: ModelIdSchema.nullable().optional().default(null),
  })
  .strict();

const ProjectModelPreferencesPatchSchema = z
  .object({
    chat: ModelIdSchema.nullable().optional(),
    embedding: ModelIdSchema.nullable().optional(),
    review: ModelIdSchema.nullable().optional(),
    writing: ModelIdSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "模型偏好至少需要一个字段",
  });

const ProjectTitleSchema = z
  .string()
  .trim()
  .min(1, "作品标题不能为空")
  .max(PROJECT_TITLE_MAX_LENGTH, "作品标题不能超过 80 个字符");

const ProjectSubtitleSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? null : value,
  z
    .string()
    .trim()
    .min(1, "副标题不能为空")
    .max(PROJECT_SUBTITLE_MAX_LENGTH, "副标题不能超过 120 个字符")
    .nullable(),
);

const ProjectGenreSchema = z
  .string()
  .trim()
  .min(1, "题材不能为空")
  .max(PROJECT_GENRE_MAX_LENGTH, "题材不能超过 40 个字符");

const ProjectPremiseSchema = z
  .string()
  .trim()
  .min(1, "核心梗概不能为空")
  .max(PROJECT_PREMISE_MAX_LENGTH, "核心梗概不能超过 2000 个字符");

const ProjectTargetAudienceSchema = z
  .string()
  .trim()
  .min(1, "目标读者不能为空")
  .max(
    PROJECT_TARGET_AUDIENCE_MAX_LENGTH,
    "目标读者不能超过 200 个字符",
  );

const ProjectTargetWordCountSchema = z
  .number()
  .int("目标字数必须是整数")
  .min(PROJECT_TARGET_WORD_COUNT_MIN, "目标字数不能少于 1000")
  .max(PROJECT_TARGET_WORD_COUNT_MAX, "目标字数不能超过 10000000");

const PositiveVersionSchema = z
  .number()
  .int()
  .positive()
  .safe();

const TimestampSchema = z.iso.datetime({ offset: true });

export const ProjectCreateInputSchema = z
  .object({
    genre: ProjectGenreSchema,
    modelPreferences: ProjectModelPreferencesSchema.optional().default({
      chat: null,
      embedding: null,
      review: null,
      writing: null,
    }),
    premise: ProjectPremiseSchema,
    subtitle: ProjectSubtitleSchema.optional().default(null),
    targetAudience: ProjectTargetAudienceSchema,
    targetWordCount: ProjectTargetWordCountSchema,
    title: ProjectTitleSchema,
  })
  .strict();

export const ProjectUpdatePatchSchema = z
  .object({
    genre: ProjectGenreSchema.optional(),
    modelPreferences: ProjectModelPreferencesPatchSchema.optional(),
    premise: ProjectPremiseSchema.optional(),
    subtitle: ProjectSubtitleSchema.optional(),
    targetAudience: ProjectTargetAudienceSchema.optional(),
    targetWordCount: ProjectTargetWordCountSchema.optional(),
    title: ProjectTitleSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要修改一个字段",
  });

export const NovelProjectSchema = z
  .object({
    archivedFromStatus: ActiveProjectStatusSchema.nullable(),
    createdAt: TimestampSchema,
    genre: ProjectGenreSchema,
    id: ProjectIdSchema,
    modelPreferences: ProjectModelPreferencesSchema,
    premise: ProjectPremiseSchema,
    projectSequence: PositiveVersionSchema,
    status: ProjectStatusSchema,
    subtitle: ProjectSubtitleSchema,
    targetAudience: ProjectTargetAudienceSchema,
    targetWordCount: ProjectTargetWordCountSchema,
    title: ProjectTitleSchema,
    updatedAt: TimestampSchema,
    version: PositiveVersionSchema,
  })
  .strict()
  .superRefine((project, context) => {
    if (
      project.status === "archived" &&
      project.archivedFromStatus === null
    ) {
      context.addIssue({
        code: "custom",
        message: "归档作品必须记录归档前状态",
        path: ["archivedFromStatus"],
      });
    }
    if (
      project.status !== "archived" &&
      project.archivedFromStatus !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "未归档作品不能保留归档前状态",
        path: ["archivedFromStatus"],
      });
    }
  });

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ActiveProjectStatus = z.infer<
  typeof ActiveProjectStatusSchema
>;
export type ProjectModelPreferences = z.infer<
  typeof ProjectModelPreferencesSchema
>;
export type ProjectCreateInput = z.input<
  typeof ProjectCreateInputSchema
>;
export type ProjectUpdatePatch = z.input<
  typeof ProjectUpdatePatchSchema
>;
export type NovelProject = z.infer<typeof NovelProjectSchema>;

export class ProjectDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectDomainError";
  }
}

export interface CreateNovelProjectContext {
  readonly id: string;
  readonly now: string;
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<ActiveProjectStatus, readonly ActiveProjectStatus[]>
> = {
  completed: ["revising"],
  planning: ["writing"],
  revising: ["writing", "completed"],
  writing: ["revising", "completed"],
};

function nextVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new ProjectDomainError(
      "projects.version_exhausted",
      "作品版本已达到安全上限",
    );
  }
  return value + 1;
}

function bumpProject(
  project: NovelProject,
  now: string,
  changes: Partial<NovelProject>,
): NovelProject {
  const parsedNow = TimestampSchema.parse(now);
  return NovelProjectSchema.parse({
    ...project,
    ...changes,
    projectSequence: nextVersion(project.projectSequence),
    updatedAt: parsedNow,
    version: nextVersion(project.version),
  });
}

function preferencesEqual(
  left: ProjectModelPreferences,
  right: ProjectModelPreferences,
): boolean {
  return (
    left.chat === right.chat &&
    left.embedding === right.embedding &&
    left.review === right.review &&
    left.writing === right.writing
  );
}

export function createNovelProject(
  input: ProjectCreateInput,
  context: CreateNovelProjectContext,
): NovelProject {
  const parsed = ProjectCreateInputSchema.parse(input);
  const now = TimestampSchema.parse(context.now);
  return NovelProjectSchema.parse({
    ...parsed,
    archivedFromStatus: null,
    createdAt: now,
    id: ProjectIdSchema.parse(context.id),
    projectSequence: 1,
    status: "planning",
    updatedAt: now,
    version: 1,
  });
}

export function updateNovelProject(
  project: NovelProject,
  patch: ProjectUpdatePatch,
  now: string,
): NovelProject {
  const current = NovelProjectSchema.parse(project);
  if (current.status === "archived") {
    throw new ProjectDomainError(
      "projects.archived",
      "归档作品需先恢复后才能编辑",
    );
  }
  const parsedPatch = ProjectUpdatePatchSchema.parse(patch);
  const modelPreferences = parsedPatch.modelPreferences
    ? ProjectModelPreferencesSchema.parse({
        ...current.modelPreferences,
        ...parsedPatch.modelPreferences,
      })
    : current.modelPreferences;
  const candidate = NovelProjectSchema.parse({
    ...current,
    ...parsedPatch,
    modelPreferences,
  });
  const changed =
    candidate.genre !== current.genre ||
    !preferencesEqual(
      candidate.modelPreferences,
      current.modelPreferences,
    ) ||
    candidate.premise !== current.premise ||
    candidate.subtitle !== current.subtitle ||
    candidate.targetAudience !== current.targetAudience ||
    candidate.targetWordCount !== current.targetWordCount ||
    candidate.title !== current.title;
  if (!changed) {
    throw new ProjectDomainError(
      "projects.no_changes",
      "作品信息没有发生变化",
    );
  }
  return bumpProject(current, now, {
    genre: candidate.genre,
    modelPreferences: candidate.modelPreferences,
    premise: candidate.premise,
    subtitle: candidate.subtitle,
    targetAudience: candidate.targetAudience,
    targetWordCount: candidate.targetWordCount,
    title: candidate.title,
  });
}

export function transitionNovelProject(
  project: NovelProject,
  targetStatus: ProjectStatus,
  now: string,
): NovelProject {
  const current = NovelProjectSchema.parse(project);
  const target = ProjectStatusSchema.parse(targetStatus);
  if (current.status === "archived" || target === "archived") {
    throw new ProjectDomainError(
      "projects.invalid_status_transition",
      "归档状态只能通过归档或恢复命令变更",
    );
  }
  if (!ALLOWED_STATUS_TRANSITIONS[current.status].includes(target)) {
    throw new ProjectDomainError(
      "projects.invalid_status_transition",
      `不能从 ${current.status} 迁移到 ${target}`,
    );
  }
  return bumpProject(current, now, { status: target });
}

export function archiveNovelProject(
  project: NovelProject,
  now: string,
): NovelProject {
  const current = NovelProjectSchema.parse(project);
  if (current.status === "archived") {
    throw new ProjectDomainError(
      "projects.already_archived",
      "作品已经归档",
    );
  }
  return bumpProject(current, now, {
    archivedFromStatus: current.status,
    status: "archived",
  });
}

export function restoreNovelProject(
  project: NovelProject,
  now: string,
): NovelProject {
  const current = NovelProjectSchema.parse(project);
  if (
    current.status !== "archived" ||
    current.archivedFromStatus === null
  ) {
    throw new ProjectDomainError(
      "projects.not_archived",
      "只有归档作品可以恢复",
    );
  }
  return bumpProject(current, now, {
    archivedFromStatus: null,
    status: current.archivedFromStatus,
  });
}
