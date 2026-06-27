import { notFound } from "next/navigation";
import { getProject } from "@/lib/storage";
import { ProjectShell } from "@/components/layout/project-shell";

type Props = { children: React.ReactNode; params: Promise<{ id: string }> };

export default async function ProjectLayout({
  children,
  params,
}: Props) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <ProjectShell projectId={id}>{children}</ProjectShell>;
}
