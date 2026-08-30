"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  BookMarked,
  Feather,
  FilePenLine,
  RotateCcw,
  Settings2,
  Target,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  NovelProject,
  ProjectUpdatePatch,
} from "../domain/project";
import {
  archiveProjectRequest,
  fetchProjectRequest,
  ProjectApiClientError,
  restoreProjectRequest,
  updateProjectRequest,
} from "./project-api-client";
import {
  ProjectFormDialog,
  type ProjectFormDirtyField,
  type ProjectFormSubmission,
} from "./project-form-dialog";
import {
  projectDetailQueryKey,
  projectListQueryKey,
} from "./project-query-keys";
import { updateProjectListCaches } from "./project-query-cache";

interface ProjectStudioProps {
  readonly initialDataUpdatedAt?: number;
  readonly initialProject: NovelProject;
}

const STATUS_LABELS = {
  archived: "已归档",
  completed: "已完成",
  planning: "筹备中",
  revising: "修订中",
  writing: "创作中",
} as const;

const MODEL_LABELS = {
  chat: "聊天",
  embedding: "Embedding",
  review: "评审",
  writing: "写作",
} as const;

function errorMessage(error: unknown): string {
  return error instanceof ProjectApiClientError
    ? error.message
    : "作品操作未能完成，请稍后重试";
}

function buildPatch(
  submission: ProjectFormSubmission,
  dirtyFields: readonly ProjectFormDirtyField[],
): ProjectUpdatePatch | undefined {
  const dirty = new Set(dirtyFields);
  const patch: ProjectUpdatePatch = {};
  if (dirty.has("genre")) {
    patch.genre = submission.genre;
  }
  if (dirty.has("premise")) {
    patch.premise = submission.premise;
  }
  if (dirty.has("subtitle")) {
    patch.subtitle = submission.subtitle;
  }
  if (dirty.has("targetAudience")) {
    patch.targetAudience = submission.targetAudience;
  }
  if (dirty.has("targetWordCount")) {
    patch.targetWordCount = submission.targetWordCount;
  }
  if (dirty.has("title")) {
    patch.title = submission.title;
  }
  const modelPreferences: NonNullable<
    ProjectUpdatePatch["modelPreferences"]
  > = {};
  if (dirty.has("chatModel")) {
    modelPreferences.chat = submission.modelPreferences.chat;
  }
  if (dirty.has("embeddingModel")) {
    modelPreferences.embedding =
      submission.modelPreferences.embedding;
  }
  if (dirty.has("reviewModel")) {
    modelPreferences.review = submission.modelPreferences.review;
  }
  if (dirty.has("writingModel")) {
    modelPreferences.writing = submission.modelPreferences.writing;
  }
  if (Object.keys(modelPreferences).length > 0) {
    patch.modelPreferences = modelPreferences;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export function ProjectStudio({
  initialDataUpdatedAt,
  initialProject,
}: ProjectStudioProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectKey = useMemo(
    () => projectDetailQueryKey(initialProject.id),
    [initialProject.id],
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editDialogError, setEditDialogError] = useState<string>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveDialogError, setArchiveDialogError] =
    useState<string>();
  const [feedback, setFeedback] = useState<string>();
  useLayoutEffect(() => {
    const cachedProject =
      queryClient.getQueryData<NovelProject>(projectKey);
    if (!cachedProject || initialProject.version > cachedProject.version) {
      queryClient.setQueryData(projectKey, initialProject, {
        updatedAt: initialDataUpdatedAt,
      });
    }
  }, [
    initialDataUpdatedAt,
    initialProject,
    projectKey,
    queryClient,
  ]);
  const query = useQuery({
    initialData: initialProject,
    initialDataUpdatedAt,
    queryFn: () => fetchProjectRequest(initialProject.id),
    queryKey: projectKey,
    staleTime: 30_000,
  });
  const project = query.data;

  function commit(nextProject: NovelProject): void {
    queryClient.setQueryData(projectKey, nextProject);
    updateProjectListCaches(queryClient, nextProject);
    void queryClient.invalidateQueries({
      queryKey: projectListQueryKey,
      refetchType: "none",
    });
    setFeedback(undefined);
    router.refresh();
  }

  async function refreshAfterConflict(): Promise<string | undefined> {
    try {
      const latest = await fetchProjectRequest(initialProject.id);
      queryClient.setQueryData(projectKey, latest);
      updateProjectListCaches(queryClient, latest);
      await queryClient.invalidateQueries({
        queryKey: projectListQueryKey,
        refetchType: "none",
      });
      return undefined;
    } catch (error) {
      return `刷新最新版本失败：${errorMessage(error)}`;
    }
  }

  const updateMutation = useMutation({
    mutationFn: ({
      current,
      patch,
    }: {
      readonly current: NovelProject;
      readonly patch: ProjectUpdatePatch;
    }) =>
      updateProjectRequest(current.id, {
        action: "update",
        expectedVersion: current.version,
        patch,
      }),
    onError: async (error) => {
      const message = errorMessage(error);
      setEditDialogError(message);
      setFeedback(message);
      if (error instanceof ProjectApiClientError && error.status === 409) {
        const refreshError = await refreshAfterConflict();
        if (refreshError) {
          setEditDialogError(refreshError);
        }
      }
    },
    onSuccess: (nextProject) => {
      setEditDialogError(undefined);
      commit(nextProject);
      setEditOpen(false);
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (current: NovelProject) =>
      archiveProjectRequest(current.id, current.version),
    onError: async (error) => {
      setArchiveDialogError(errorMessage(error));
      if (error instanceof ProjectApiClientError && error.status === 409) {
        const refreshError = await refreshAfterConflict();
        if (refreshError) {
          setArchiveDialogError(refreshError);
        }
      }
    },
    onSuccess: (nextProject) => {
      setArchiveDialogError(undefined);
      commit(nextProject);
      setArchiveOpen(false);
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (current: NovelProject) =>
      restoreProjectRequest(current.id, current.version),
    onError: async (error) => {
      setFeedback(errorMessage(error));
      if (error instanceof ProjectApiClientError && error.status === 409) {
        const refreshError = await refreshAfterConflict();
        if (refreshError) {
          setFeedback(refreshError);
        }
      }
    },
    onSuccess: commit,
  });

  async function handleEdit(
    submission: ProjectFormSubmission,
    dirtyFields: readonly ProjectFormDirtyField[],
  ): Promise<void> {
    const patch = buildPatch(submission, dirtyFields);
    if (!patch) {
      setEditDialogError("作品信息没有发生变化");
      return;
    }
    setEditDialogError(undefined);
    setFeedback(undefined);
    updateMutation.mutate({ current: project, patch });
  }

  function handleEditOpenChange(open: boolean): void {
    setEditDialogError(undefined);
    setEditOpen(open);
  }

  function handleArchiveOpenChange(open: boolean): void {
    setArchiveDialogError(undefined);
    setArchiveOpen(open);
  }

  function handleArchive(): void {
    setArchiveDialogError(undefined);
    archiveMutation.mutate(project);
  }

  return (
    <main className="min-h-screen bg-[#f3ede1] text-[#28241e]">
      <div className="border-b border-[#d7ccba] bg-[#eee5d6]">
        <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "rounded-none text-[#504a42]",
            )}
          >
            <ArrowLeft aria-hidden="true" />
            返回作品台
          </Link>
          <div className="inline-flex items-center gap-2 font-serif text-sm font-semibold">
            <Feather className="size-4 text-primary" aria-hidden="true" />
            墨章编辑部
          </div>
        </header>
      </div>

      <section className="mx-auto max-w-7xl px-5 pb-16 pt-9 sm:px-8 sm:pt-12">
        {feedback || query.error ? (
          <div
            className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-[#b65454] bg-[#fff8f2] px-4 py-3 text-sm text-[#7f3030]"
            role="alert"
          >
            <span>{feedback ?? errorMessage(query.error)}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFeedback(undefined);
                void query.refetch();
              }}
            >
              重新加载
            </Button>
          </div>
        ) : null}

        <div className="grid gap-8 border-b border-[#cfc3b0] pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="border border-[#c7baa6] bg-[#e8dece] px-2.5 py-1 text-[11px] font-semibold tracking-wider">
                {STATUS_LABELS[project.status]}
              </span>
              <span className="text-xs text-primary">{project.genre}</span>
              <span className="font-mono text-[10px] text-[#80766a]">
                v{project.version} · seq {project.projectSequence}
              </span>
            </div>
            <h1 className="font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              {project.title}
            </h1>
            {project.subtitle ? (
              <p className="mt-3 font-serif text-lg text-[#696156]">
                {project.subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {project.status === "archived" ? (
              <Button
                className="h-10 rounded-none"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(project)}
              >
                <RotateCcw aria-hidden="true" />
                {restoreMutation.isPending ? "正在恢复…" : "恢复作品"}
              </Button>
            ) : (
              <>
                <Button
                  className="h-10 rounded-none"
                  variant="outline"
                  onClick={() => handleEditOpenChange(true)}
                >
                  <Settings2 aria-hidden="true" />
                  编辑作品
                </Button>
                <Button
                  className="h-10 rounded-none"
                  variant="ghost"
                  onClick={() => handleArchiveOpenChange(true)}
                >
                  <Archive aria-hidden="true" />
                  归档作品
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.75fr)]">
          <article className="border border-[#cec1ae] bg-[#fbf7ef] p-6 shadow-[4px_4px_0_#ddd1bf] sm:p-8">
            <p className="text-xs font-semibold tracking-[0.24em] text-primary">
              PREMISE
            </p>
            <h2 className="mt-3 font-serif text-xl font-semibold">
              故事核心
            </h2>
            <p className="mt-5 whitespace-pre-wrap text-base leading-8 text-[#4e4840]">
              {project.premise}
            </p>
          </article>

          <aside className="border border-[#cec1ae] bg-[#e9dfcf] p-6">
            <p className="text-xs font-semibold tracking-[0.24em] text-primary">
              CREATIVE BRIEF
            </p>
            <dl className="mt-5 space-y-5 text-sm">
              <BriefItem
                icon={<Target aria-hidden="true" />}
                label="目标字数"
                value={`${project.targetWordCount.toLocaleString("zh-CN")} 字`}
              />
              <BriefItem
                icon={<BookMarked aria-hidden="true" />}
                label="目标读者"
                value={project.targetAudience}
              />
            </dl>
          </aside>
        </div>

        <section className="mt-9">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.24em] text-primary">
                WRITING ROOMS
              </p>
              <h2 className="mt-2 font-serif text-2xl font-semibold">
                创作工作台
              </h2>
            </div>
            <p className="hidden text-xs text-[#766e62] sm:block">
              本阶段仅接入作品目录
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StudioPlaceholder
              index="01"
              title="稿件"
              description="章节与正文将在稿件垂直切片接入。"
            />
            <StudioPlaceholder
              index="02"
              title="创作计划"
              description="大纲与情节推进将在叙事切片接入。"
            />
            <StudioPlaceholder
              index="03"
              title="设定档案"
              description="人物与世界事实将在正典切片接入。"
            />
          </div>
        </section>

        <section className="mt-9 border-t border-[#cfc3b0] pt-8">
          <h2 className="font-serif text-xl font-semibold">模型偏好</h2>
          <p className="mt-2 text-sm text-[#70685d]">
            未单独指定的角色继承全局默认模型。
          </p>
          <div className="mt-4 grid gap-px border border-[#cfc3b0] bg-[#cfc3b0] sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(MODEL_LABELS).map(([role, label]) => (
              <div className="bg-[#f8f2e8] p-4" key={role}>
                <p className="text-xs text-[#746c61]">{label}</p>
                <p className="mt-2 truncate font-mono text-xs">
                  {project.modelPreferences[
                    role as keyof NovelProject["modelPreferences"]
                  ] ?? "继承全局"}
                </p>
              </div>
            ))}
          </div>
        </section>
      </section>

      <ProjectFormDialog
        busy={updateMutation.isPending}
        mode="edit"
        onOpenChange={handleEditOpenChange}
        onSubmit={handleEdit}
        open={editOpen}
        project={project}
        submitError={editDialogError}
      />

      <Dialog
        open={archiveOpen}
        onOpenChange={handleArchiveOpenChange}
      >
        <DialogContent
          className="border-[#d4c7b4] bg-[#fffaf1] sm:max-w-md"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              归档这部作品？
            </DialogTitle>
            <DialogDescription className="leading-6">
              <span className="block">归档不会删除任何内容</span>
              <span className="block">
                作品会移至归档架，之后可随时恢复到当前创作状态。
              </span>
            </DialogDescription>
          </DialogHeader>
          {archiveDialogError ? (
            <div
              className="border border-[#b65454] bg-[#fff8f2] px-4 py-3 text-sm text-[#7f3030]"
              aria-live="assertive"
              role="alert"
            >
              {archiveDialogError}
            </div>
          ) : null}
          <DialogFooter className="border-[#ded4c3] bg-[#f4ede1]">
            <Button
              variant="ghost"
              onClick={() => handleArchiveOpenChange(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={archiveMutation.isPending}
              onClick={handleArchive}
            >
              {archiveMutation.isPending ? "正在归档…" : "确认归档"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function BriefItem({
  icon,
  label,
  value,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="grid grid-cols-[1.5rem_1fr] gap-x-3">
      <span className="mt-0.5 text-primary [&_svg]:size-4">{icon}</span>
      <div>
        <dt className="text-xs text-[#756d61]">{label}</dt>
        <dd className="mt-1 leading-6 text-[#39342e]">{value}</dd>
      </div>
    </div>
  );
}

function StudioPlaceholder({
  description,
  index,
  title,
}: {
  readonly description: string;
  readonly index: string;
  readonly title: string;
}) {
  return (
    <article className="min-h-44 border border-[#d1c5b3] bg-[#f7f1e7] p-5 text-[#746c61]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em]">
          ROOM {index}
        </span>
        <FilePenLine className="size-4" aria-hidden="true" />
      </div>
      <h3 className="mt-8 font-serif text-lg font-semibold text-[#39342e]">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6">{description}</p>
    </article>
  );
}
