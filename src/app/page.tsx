import {
  getProjectsApplication,
  ProjectsWorkbench,
  type ProjectPage,
} from "@/modules/projects";

export const dynamic = "force-dynamic";

const EMPTY_PAGE: ProjectPage = {
  catalogVersion: 0,
  items: [],
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
};

export default async function HomePage() {
  const result = getProjectsApplication().listProjects({
    page: 1,
    pageSize: 12,
  });
  return (
    <ProjectsWorkbench
      initialDataUpdatedAt={
        result.ok ? result.value.fetchedAt : undefined
      }
      initialError={result.ok ? undefined : result.error.message}
      initialPage={result.ok ? result.value : EMPTY_PAGE}
    />
  );
}
