"use client";

import { useEffect, useRef, useState } from "react";
import {
  useForm,
  type FieldErrors,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  NovelProject,
  ProjectCreateInput,
} from "../domain/project";

const GENRES = [
  "悬疑",
  "科幻",
  "奇幻",
  "都市",
  "历史",
  "武侠",
  "言情",
  "现实",
  "其他",
] as const;

function requiredTextSchema(
  label: string,
  maxLength: number,
) {
  return z
    .string({ error: `${label}必须是文本` })
    .trim()
    .min(1, { error: `请输入${label}` })
    .max(maxLength, {
      error: `${label}不能超过 ${maxLength} 个字符`,
    });
}

function optionalTextSchema(
  label: string,
  maxLength: number,
) {
  return z
    .string({ error: `${label}必须是文本` })
    .trim()
    .max(maxLength, {
      error: `${label}不能超过 ${maxLength} 个字符`,
    });
}

function modelIdSchema(label: string) {
  return z
    .string({ error: `${label} ID 必须是文本` })
    .trim()
    .max(160, {
      error: `${label} ID 不能超过 160 个字符`,
    });
}

const ProjectFormValuesSchema = z
  .object({
    chatModel: modelIdSchema("聊天模型"),
    embeddingModel: modelIdSchema("Embedding 模型"),
    genre: requiredTextSchema("题材", 40),
    premise: requiredTextSchema("核心梗概", 2_000),
    reviewModel: modelIdSchema("评审模型"),
    subtitle: optionalTextSchema("副标题", 120),
    targetAudience: requiredTextSchema("目标读者", 200),
    targetWordCount: z
      .number({ error: "请输入有效的目标字数" })
      .int({ error: "目标字数必须是整数" })
      .min(1_000, { error: "目标字数不能少于 1,000 字" })
      .max(10_000_000, {
        error: "目标字数不能超过 10,000,000 字",
      }),
    title: requiredTextSchema("书名", 80),
    writingModel: modelIdSchema("写作模型"),
  })
  .strict();

type ProjectFormValues = z.infer<typeof ProjectFormValuesSchema>;
export type ProjectFormDirtyField = keyof ProjectFormValues;

export interface ProjectFormSubmission extends ProjectCreateInput {
  readonly modelPreferences: {
    readonly chat: string | null;
    readonly embedding: string | null;
    readonly review: string | null;
    readonly writing: string | null;
  };
  readonly subtitle: string | null;
}

interface ProjectFormDialogProps {
  readonly busy: boolean;
  readonly mode: "create" | "edit";
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (
    value: ProjectFormSubmission,
    dirtyFields: readonly ProjectFormDirtyField[],
  ) => Promise<void>;
  readonly open: boolean;
  readonly project?: NovelProject;
  readonly submitError?: string;
}

function defaults(project?: NovelProject): ProjectFormValues {
  return {
    chatModel: project?.modelPreferences.chat ?? "",
    embeddingModel: project?.modelPreferences.embedding ?? "",
    genre: project?.genre ?? "悬疑",
    premise: project?.premise ?? "",
    reviewModel: project?.modelPreferences.review ?? "",
    subtitle: project?.subtitle ?? "",
    targetAudience: project?.targetAudience ?? "成年类型文学读者",
    targetWordCount: project?.targetWordCount ?? 180_000,
    title: project?.title ?? "",
    writingModel: project?.modelPreferences.writing ?? "",
  };
}

function fieldMessage(
  errors: FieldErrors<ProjectFormValues>,
  field: keyof ProjectFormValues,
): string | undefined {
  const message = errors[field]?.message;
  return typeof message === "string" ? message : undefined;
}

function optionalModel(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

const FIELD_LABELS: Readonly<
  Record<ProjectFormDirtyField, string>
> = {
  chatModel: "聊天模型",
  embeddingModel: "Embedding 模型",
  genre: "题材",
  premise: "核心梗概",
  reviewModel: "评审模型",
  subtitle: "副标题",
  targetAudience: "目标读者",
  targetWordCount: "目标字数",
  title: "书名",
  writingModel: "写作模型",
};

export function ProjectFormDialog({
  busy,
  mode,
  onOpenChange,
  onSubmit,
  open,
  project,
  submitError,
}: ProjectFormDialogProps) {
  const form = useForm<ProjectFormValues>({
    defaultValues: defaults(project),
  });
  const wasOpen = useRef(false);
  const baseValues = useRef(defaults(project));
  const baseVersion = useRef(project?.version);
  const [conflictingFields, setConflictingFields] = useState<
    readonly ProjectFormDirtyField[]
  >([]);
  const [conflictsAccepted, setConflictsAccepted] = useState(false);
  const dirtyFields = form.formState.dirtyFields;

  useEffect(() => {
    const nextValues = defaults(project);
    if (open && !wasOpen.current) {
      form.reset(nextValues);
      baseValues.current = nextValues;
      baseVersion.current = project?.version;
      setConflictingFields([]);
      setConflictsAccepted(false);
    } else if (
      open &&
      project?.version !== undefined &&
      project.version !== baseVersion.current
    ) {
      const conflicts = (
        Object.keys(dirtyFields) as ProjectFormDirtyField[]
      ).filter(
        (field) =>
          dirtyFields[field] === true &&
          baseValues.current[field] !== nextValues[field],
      );
      form.reset(nextValues, { keepDirtyValues: true });
      baseValues.current = nextValues;
      baseVersion.current = project.version;
      setConflictingFields(conflicts);
      setConflictsAccepted(false);
    }
    wasOpen.current = open;
  }, [dirtyFields, form, open, project]);

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors();
    if (
      mode === "edit" &&
      conflictingFields.length > 0 &&
      !conflictsAccepted
    ) {
      return;
    }
    const parsed = ProjectFormValuesSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in values) {
          form.setError(field as keyof ProjectFormValues, {
            message: issue.message,
            type: "validate",
          });
        }
      }
      return;
    }
    const changedFields = (
      Object.keys(dirtyFields) as ProjectFormDirtyField[]
    ).filter((field) => dirtyFields[field] === true);
    await onSubmit(
      {
        genre: parsed.data.genre,
        modelPreferences: {
          chat: optionalModel(parsed.data.chatModel),
          embedding: optionalModel(parsed.data.embeddingModel),
          review: optionalModel(parsed.data.reviewModel),
          writing: optionalModel(parsed.data.writingModel),
        },
        premise: parsed.data.premise,
        subtitle: optionalModel(parsed.data.subtitle),
        targetAudience: parsed.data.targetAudience,
        targetWordCount: parsed.data.targetWordCount,
        title: parsed.data.title,
      },
      changedFields,
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(92vh,780px)] overflow-y-auto border-[#d8cdbb] bg-[#fffdf8] p-0 text-[#29251f] sm:max-w-2xl"
        showCloseButton={false}
      >
        <form noValidate onSubmit={submit}>
          <DialogHeader className="border-b border-[#ded4c3] px-6 py-5">
            <p className="text-xs font-medium tracking-[0.24em] text-primary">
              {mode === "create" ? "NEW MANUSCRIPT" : "PROJECT NOTES"}
            </p>
            <DialogTitle className="font-serif text-2xl font-semibold">
              {mode === "create" ? "新建一部作品" : "编辑作品档案"}
            </DialogTitle>
            <DialogDescription className="text-[#6e675d]">
              从一句清晰的故事前提开始，之后仍可随时调整。
            </DialogDescription>
          </DialogHeader>

          {submitError ? (
            <div
              className="mx-6 mt-5 border border-[#b65454] bg-[#fff8f2] px-4 py-3 text-sm text-[#7f3030]"
              id="project-form-submit-error"
              role="alert"
            >
              {submitError}
            </div>
          ) : null}

          {conflictingFields.length > 0 ? (
            <div
              className="mx-6 mt-5 border border-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              role="alert"
            >
              <p>
                服务器也修改了以下字段：
                {conflictingFields
                  .map((field) => FIELD_LABELS[field])
                  .join("、")}
                。请确认是否保留你的修改。
              </p>
              {!conflictsAccepted ? (
                <Button
                  className="mt-3"
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => setConflictsAccepted(true)}
                >
                  确认保留我的修改
                </Button>
              ) : (
                <p className="mt-2 font-medium">
                  已确认；再次保存将覆盖这些字段的服务器新值。
                </p>
              )}
            </div>
          ) : null}

          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <FormField
              error={fieldMessage(form.formState.errors, "title")}
              htmlFor="project-title"
              label="书名"
              required
            >
              <Input
                autoFocus
                id="project-title"
                maxLength={80}
                placeholder="例如：纸上迷城"
                required
                aria-describedby={
                  form.formState.errors.title
                    ? "project-title-error"
                    : undefined
                }
                aria-invalid={Boolean(form.formState.errors.title)}
                aria-required="true"
                {...form.register("title")}
              />
            </FormField>
            <FormField
              error={fieldMessage(form.formState.errors, "subtitle")}
              htmlFor="project-subtitle"
              label="副标题（选填）"
            >
              <Input
                id="project-subtitle"
                maxLength={120}
                placeholder="一行补充说明"
                aria-describedby={
                  form.formState.errors.subtitle
                    ? "project-subtitle-error"
                    : undefined
                }
                aria-invalid={Boolean(form.formState.errors.subtitle)}
                {...form.register("subtitle")}
              />
            </FormField>

            <FormField
              error={fieldMessage(form.formState.errors, "genre")}
              htmlFor="project-genre"
              label="题材"
              required
            >
              <Input
                id="project-genre"
                autoComplete="off"
                list="project-genre-suggestions"
                maxLength={40}
                placeholder="选择建议或输入自定义题材"
                required
                aria-describedby={
                  form.formState.errors.genre
                    ? "project-genre-error"
                    : undefined
                }
                aria-invalid={Boolean(form.formState.errors.genre)}
                aria-required="true"
                {...form.register("genre")}
              />
              <datalist id="project-genre-suggestions">
                {GENRES.map((genre) => (
                  <option key={genre} value={genre}>
                    {genre}
                  </option>
                ))}
              </datalist>
            </FormField>
            <FormField
              error={fieldMessage(
                form.formState.errors,
                "targetWordCount",
              )}
              htmlFor="project-target-word-count"
              label="目标字数"
              required
            >
              <Input
                id="project-target-word-count"
                inputMode="numeric"
                min={1_000}
                max={10_000_000}
                step={1_000}
                type="number"
                required
                aria-describedby={
                  form.formState.errors.targetWordCount
                    ? "project-target-word-count-error"
                    : undefined
                }
                aria-invalid={Boolean(
                  form.formState.errors.targetWordCount,
                )}
                aria-required="true"
                {...form.register("targetWordCount", {
                  valueAsNumber: true,
                })}
              />
            </FormField>

            <div className="sm:col-span-2">
              <FormField
                error={fieldMessage(form.formState.errors, "premise")}
                htmlFor="project-premise"
                label="核心梗概"
                required
              >
                <Textarea
                  id="project-premise"
                  maxLength={2_000}
                  placeholder="主人公是谁、想要什么，又有什么阻止了他？"
                  rows={5}
                  required
                  aria-describedby={
                    form.formState.errors.premise
                      ? "project-premise-error"
                      : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.premise)}
                  aria-required="true"
                  {...form.register("premise")}
                />
              </FormField>
            </div>

            <div className="sm:col-span-2">
              <FormField
                error={fieldMessage(
                  form.formState.errors,
                  "targetAudience",
                )}
                htmlFor="project-target-audience"
                label="目标读者"
                required
              >
                <Input
                  id="project-target-audience"
                  maxLength={200}
                  placeholder="例如：喜爱都市奇幻与本格推理的成年读者"
                  required
                  aria-describedby={
                    form.formState.errors.targetAudience
                      ? "project-target-audience-error"
                      : undefined
                  }
                  aria-invalid={Boolean(
                    form.formState.errors.targetAudience,
                  )}
                  aria-required="true"
                  {...form.register("targetAudience")}
                />
              </FormField>
            </div>

            <fieldset className="grid gap-4 border-t border-[#e5dccd] pt-5 sm:col-span-2 sm:grid-cols-2">
              <legend className="pr-3 font-serif text-base font-semibold">
                模型偏好
              </legend>
              <p className="-mt-2 text-xs text-[#7b7368] sm:col-span-2">
                留空即继承全局默认；这里只保存模型 ID，不保存密钥。
              </p>
              <ModelField
                error={fieldMessage(
                  form.formState.errors,
                  "chatModel",
                )}
                id="project-chat-model"
                label="聊天模型"
                registration={form.register("chatModel")}
              />
              <ModelField
                error={fieldMessage(
                  form.formState.errors,
                  "writingModel",
                )}
                id="project-writing-model"
                label="写作模型"
                registration={form.register("writingModel")}
              />
              <ModelField
                error={fieldMessage(
                  form.formState.errors,
                  "reviewModel",
                )}
                id="project-review-model"
                label="评审模型"
                registration={form.register("reviewModel")}
              />
              <ModelField
                error={fieldMessage(
                  form.formState.errors,
                  "embeddingModel",
                )}
                id="project-embedding-model"
                label="Embedding 模型"
                registration={form.register("embeddingModel")}
              />
            </fieldset>
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-none border-[#ded4c3] bg-[#f4efe4] px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy
                ? "正在保存…"
                : mode === "create"
                  ? "创建并进入工作台"
                  : "保存修改"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  children,
  error,
  htmlFor,
  label,
  required = false,
}: {
  readonly children: React.ReactNode;
  readonly error?: string;
  readonly htmlFor: string;
  readonly label: string;
  readonly required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        {required ? (
          <span className="text-primary" aria-hidden="true">
            *
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p
          className="text-xs text-destructive"
          id={`${htmlFor}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ModelField({
  error,
  id,
  label,
  registration,
}: {
  readonly error?: string;
  readonly id: string;
  readonly label: string;
  readonly registration: UseFormRegisterReturn;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        maxLength={160}
        placeholder="继承全局默认"
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={Boolean(error)}
        {...registration}
      />
      {error ? (
        <p
          className="text-xs text-destructive"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
