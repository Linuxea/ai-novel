import { listProjects } from "@/lib/storage";
import { ProjectList } from "@/components/home/project-list";

export default async function HomePage() {
  const projects = await listProjects();
  return <ProjectList initialProjects={projects} />;
}
