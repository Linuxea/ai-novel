"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  BookOpenText,
  Feather,
  Plus,
  Search,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProjectPage } from "../application/ports";
import type { NovelProject } from "../domain/project";
import {
  createProjectRequest,
  fetchProjectList,
  ProjectApiClientError,
} from "./project-api-client";
import {
  ProjectFormDialog,
  type ProjectFormSubmission,
} from "./project-form-dialog";
import {
  projectDetailQueryKey,
  projectListQueryKey,
} from "./project-query-keys";
import { updateProjectListCaches } from "./project-query-cache";

interface ProjectsWorkbenchProps {
  readonly initialDataUpdatedAt?: number;
  readonly initialError?: string;
  readonly initialPage: ProjectPage;
}

const STATUS_LABELS = {
  archived: "已归档",
  completed: "已完成",
  planning: "筹备中",
  revising: "修订中",
  writing: "创作中",
} as const;

const INITIAL_PROJECT_LIST_QUERY_KEY = [
  "projects",
  "active",
  "",
  1,
] as const;

function initialResponse(page: ProjectPage) {
  return {
    data: [...page.items],
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: page.totalPages,
    },
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof ProjectApiClientError
    ? error.message
    : "作品操作未能完成，请稍后重试";
}

export function ProjectsWorkbench({
  initialDataUpdatedAt,
  initialError,
  initialPage,
}: ProjectsWorkbenchProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDialogError, setCreateDialogError] =
    useState<string>();
  const [feedback, setFeedback] = useState<string | undefined>(
    initialError,
  );
  const normalizedSearch = search.trim();
  useLayoutEffect(() => {
    const incoming = initialResponse(initialPage);
    const cached =
      queryClient.getQueryData<ReturnType<typeof initialResponse>>(
        INITIAL_PROJECT_LIST_QUERY_KEY,
      );
    const cachedState = queryClient.getQueryState(
      INITIAL_PROJECT_LIST_QUERY_KEY,
    );
    if (
      !cached ||
      (initialDataUpdatedAt !== undefined &&
        initialDataUpdatedAt > (cachedState?.dataUpdatedAt ?? 0))
    ) {
      queryClient.setQueryData(INITIAL_PROJECT_LIST_QUERY_KEY, incoming, {
        updatedAt: initialDataUpdatedAt,
      });
      return;
    }
    const merged = cached.data.map((cachedProject) => {
      const incomingProject = incoming.data.find(
        (item) => item.id === cachedProject.id,
      );
      return incomingProject &&
        incomingProject.version > cachedProject.version
        ? incomingProject
        : cachedProject;
    });
    if (
      merged.some(
        (project, index) => project !== cached.data[index],
      )
    ) {
      queryClient.setQueryData(
        INITIAL_PROJECT_LIST_QUERY_KEY,
        { ...cached, data: merged },
        { updatedAt: cachedState?.dataUpdatedAt },
      );
    }
  }, [initialDataUpdatedAt, initialPage, queryClient]);
  const query = useQuery({
    initialData:
      view === "active" &&
      page === 1 &&
      normalizedSearch.length === 0
        ? initialResponse(initialPage)
        : undefined,
    initialDataUpdatedAt,
    queryFn: () =>
      fetchProjectList({
        page: String(page),
        pageSize: "12",
        ...(normalizedSearch ? { search: normalizedSearch } : {}),
        ...(view === "archived"
          ? { status: "archived" }
          : {}),
      }),
    queryKey: ["projects", view, normalizedSearch, page],
    staleTime: 30_000,
  });
  const createMutation = useMutation({
    mutationFn: createProjectRequest,
    onError: (error) => {
      const message = errorMessage(error);
      setCreateDialogError(message);
      setFeedback(message);
    },
    onSuccess: (project) => {
      queryClient.setQueryData(
        projectDetailQueryKey(project.id),
        project,
      );
      updateProjectListCaches(queryClient, project);
      void queryClient.invalidateQueries({
        queryKey: projectListQueryKey,
        refetchType: "none",
      });
      setCreateDialogError(undefined);
      setFeedback(undefined);
      setCreateOpen(false);
      router.push(`/studio/${project.id}`);
    },
  });

  async function handleCreate(
    submission: ProjectFormSubmission,
  ): Promise<void> {
    setCreateDialogError(undefined);
    setFeedback(undefined);
    createMutation.mutate(submission);
  }

  function handleCreateOpenChange(open: boolean): void {
    setCreateDialogError(undefined);
    setCreateOpen(open);
  }

  const projects = query.data?.data ?? [];
  const loadError = query.error ? errorMessage(query.error) : undefined;

  return (
    <main className="min-h-screen bg-[#f3ede1] text-[#28241e]">
      <div className="border-b border-[#d7ccba] bg-[#eee5d6]">
        <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="group inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span className="flex size-9 items-center justify-center border border-[#2e2a24] bg-[#29251f] text-[#f7f0e4]">
              <Feather className="size-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-serif text-lg font-semibold leading-none">
                墨章
              </span>
              <span className="mt-1 block text-[10px] tracking-[0.22em] text-[#766e62]">
                EDITORIAL DESK
              </span>
            </span>
          </Link>
          <Button
            className="h-10 rounded-none px-4 shadow-[3px_3px_0_#2b2721]"
            onClick={() => handleCreateOpenChange(true)}
          >
            <Plus aria-hidden="true" />
            新建作品
          </Button>
        </header>
      </div>

      <section className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <div className="grid gap-8 border-b border-[#cfc3b0] pb-9 lg:grid-cols-[1fr_22rem] lg:items-end">
          <div>
            <p className="mb-3 text-xs font-semibold tracking-[0.26em] text-primary">
              MANUSCRIPT CATALOGUE
            </p>
            <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
              作品台
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#696156] sm:text-base">
              收拢每一部正在生长的小说。先写清故事的方向，再从容进入创作。
            </p>
          </div>
          <div className="relative">
            <label className="sr-only" htmlFor="project-search">
              搜索作品
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#80776a]"
              aria-hidden="true"
            />
            <Input
              id="project-search"
              className="h-11 rounded-none border-[#bfb29f] bg-[#fbf7ef] pl-10"
              placeholder="按书名或梗概检索"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <div
            className="inline-flex border border-[#c9bdab] bg-[#e9dfcf] p-1"
            aria-label="作品视图"
            role="group"
          >
            <ViewButton
              active={view === "active"}
              onClick={() => {
                setView("active");
                setPage(1);
              }}
            >
              进行中
            </ViewButton>
            <ViewButton
              active={view === "archived"}
              onClick={() => {
                setView("archived");
                setPage(1);
              }}
            >
              已归档
            </ViewButton>
          </div>
          <p className="text-xs tracking-wide text-[#756d61]">
            共 {query.data?.pagination.total ?? 0} 部作品
          </p>
        </div>

        {feedback || loadError ? (
          <div
            className="mt-6 flex flex-wrap items-center justify-between gap-3 border border-[#b65454] bg-[#fff8f2] px-4 py-3 text-sm text-[#7f3030]"
            role="alert"
          >
            <span>{feedback ?? loadError}</span>
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

        {query.isPending ? (
          <LoadingGrid />
        ) : projects.length === 0 ? (
          <EmptyState
            archived={view === "archived"}
            searching={normalizedSearch.length > 0}
            onCreate={() => handleCreateOpenChange(true)}
          />
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project, index) => (
              <ProjectCard
                index={index}
                key={project.id}
                project={project}
              />
            ))}
          </div>
        )}

        {(query.data?.pagination.totalPages ?? 0) > 1 ? (
          <nav
            className="mt-8 flex items-center justify-between border-t border-[#cfc3b0] pt-5"
            aria-label="作品分页"
          >
            <Button
              className="rounded-none"
              disabled={page <= 1 || query.isFetching}
              variant="outline"
              onClick={() =>
                setPage((current) => Math.max(1, current - 1))
              }
            >
              上一页
            </Button>
            <span className="text-xs text-[#70685d]">
              第 {query.data?.pagination.page ?? page} /{" "}
              {query.data?.pagination.totalPages ?? 1} 页
            </span>
            <Button
              className="rounded-none"
              disabled={
                page >= (query.data?.pagination.totalPages ?? 1) ||
                query.isFetching
              }
              variant="outline"
              onClick={() => setPage((current) => current + 1)}
            >
              下一页
            </Button>
          </nav>
        ) : null}
      </section>

      <ProjectFormDialog
        busy={createMutation.isPending}
        mode="create"
        onOpenChange={handleCreateOpenChange}
        onSubmit={handleCreate}
        open={createOpen}
        submitError={createDialogError}
      />
    </main>
  );
}

function ViewButton({
  active,
  children,
  onClick,
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "min-h-9 px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
        active
          ? "bg-[#2b2721] text-[#fbf6ec]"
          : "text-[#625b51] hover:bg-[#f5eee2]",
      )}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ProjectCard({
  index,
  project,
}: {
  readonly index: number;
  readonly project: NovelProject;
}) {
  return (
    <article className="group relative flex min-h-72 flex-col border border-[#cfc3b1] bg-[#fbf7ef] p-6 shadow-[4px_4px_0_#ded3c2] transition-transform hover:-translate-y-1">
      <div className="mb-8 flex items-start justify-between gap-4">
        <span className="font-mono text-[10px] tracking-[0.18em] text-[#8b8173]">
          MS — {String(index + 1).padStart(3, "0")}
        </span>
        <span className="border border-[#cfc2ae] px-2 py-1 text-[10px] font-semibold tracking-wider text-[#655d52]">
          {STATUS_LABELS[project.status]}
        </span>
      </div>
      <div className="flex-1">
        <p className="mb-2 text-xs text-primary">{project.genre}</p>
        <h2 className="font-serif text-2xl font-semibold leading-tight">
          {project.title}
        </h2>
        {project.subtitle ? (
          <p className="mt-2 font-serif text-sm text-[#6f675c]">
            {project.subtitle}
          </p>
        ) : null}
        <p className="mt-5 line-clamp-3 text-sm leading-6 text-[#625b51]">
          {project.premise}
        </p>
      </div>
      <div className="mt-7 flex items-end justify-between border-t border-[#ded4c4] pt-4">
        <div className="text-[11px] leading-5 text-[#7c7367]">
          <p>{project.targetWordCount.toLocaleString("zh-CN")} 字</p>
          <p>更新于 {formatDate(project.updatedAt)}</p>
        </div>
        <Link
          href={`/studio/${project.id}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "rounded-none border border-[#c9bdab] group-hover:border-primary group-hover:text-primary",
          )}
          aria-label={`打开《${project.title}》工作台`}
        >
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function EmptyState({
  archived,
  onCreate,
  searching,
}: {
  readonly archived: boolean;
  readonly onCreate: () => void;
  readonly searching: boolean;
}) {
  return (
    <div className="mt-8 grid min-h-80 place-items-center border border-dashed border-[#bcae99] bg-[#f8f2e7] px-6 text-center">
      <div className="max-w-md">
        <BookOpenText
          className="mx-auto mb-5 size-10 text-[#8b8174]"
          strokeWidth={1.25}
          aria-hidden="true"
        />
        <h2 className="font-serif text-2xl font-semibold">
          {searching
            ? "没有找到相符作品"
            : archived
              ? "归档架还是空的"
              : "还没有作品"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#70685d]">
          {searching
            ? "试试更短的关键词，或切换作品视图。"
            : archived
              ? "归档后的作品会完整保存在这里，随时可以恢复。"
              : "为你的下一部长篇留下一张正式的作品卡片。"}
        </p>
        {!archived && !searching ? (
          <Button
            className="mt-6 h-10 rounded-none"
            onClick={onCreate}
          >
            <Plus aria-hidden="true" />
            新建作品
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div
      className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3"
      aria-label="正在载入作品"
    >
      {[0, 1, 2].map((item) => (
        <div
          className="h-72 animate-pulse border border-[#d7ccba] bg-[#e9dfd0]"
          key={item}
        />
      ))}
    </div>
  );
}
