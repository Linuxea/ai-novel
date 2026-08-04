import { notFound } from "next/navigation";
import { getProjectData } from "@/lib/storage";
import { ProjectShell } from "@/components/layout/project-shell";
import { ProjectStoreProvider } from "@/lib/store";

type Props = { children: React.ReactNode; params: Promise<{ id: string }> };

export default async function ProjectLayout({
  children,
  params,
}: Props) {
  const { id } = await params;
  const data = await getProjectData(id);
  if (!data) notFound();

  return (
    <ProjectStoreProvider key={id} initialData={data}>
      <ProjectShell projectId={id}>{children}</ProjectShell>
    </ProjectStoreProvider>
  );
}
