import type { QueryClient } from "@tanstack/react-query";
import type { NovelProject } from "../domain/project";
import { projectListQueryKey } from "./project-query-keys";

interface CachedProjectList {
  readonly data: readonly NovelProject[];
  readonly pagination?: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

function updatePagination(
  pagination: CachedProjectList["pagination"],
  delta: number,
) {
  if (!pagination || delta === 0) {
    return pagination;
  }
  const total = Math.max(0, pagination.total + delta);
  return {
    ...pagination,
    total,
    totalPages:
      total === 0 ? 0 : Math.ceil(total / pagination.pageSize),
  };
}

export function updateProjectListCaches(
  queryClient: QueryClient,
  project: NovelProject,
): void {
  const lists =
    queryClient.getQueriesData<CachedProjectList>({
      queryKey: projectListQueryKey,
    });
  for (const [queryKey, cached] of lists) {
    if (!cached) {
      continue;
    }
    const view = queryKey[1];
    const search = queryKey[2];
    const page = queryKey[3];
    const belongs =
      (view === "archived") === (project.status === "archived");
    const existingIndex = cached.data.findIndex(
      (item) => item.id === project.id,
    );
    let data = [...cached.data];
    let delta = 0;

    if (existingIndex >= 0) {
      const existing = data[existingIndex]!;
      if (!belongs) {
        data.splice(existingIndex, 1);
        delta = -1;
      } else if (project.version > existing.version) {
        data[existingIndex] = project;
      }
    } else if (
      belongs &&
      search === "" &&
      page === 1
    ) {
      data = [project, ...data].slice(
        0,
        cached.pagination?.pageSize ?? data.length + 1,
      );
      delta = 1;
    }

    queryClient.setQueryData<CachedProjectList>(queryKey, {
      data,
      pagination: updatePagination(cached.pagination, delta),
    });
  }
}
