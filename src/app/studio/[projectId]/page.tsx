import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProjectsApplication,
  ProjectStudio,
} from "@/modules/projects";
import { buttonVariants } from "@/components/ui/button";

interface StudioPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function StudioPage({
  params,
}: StudioPageProps) {
  const { projectId } = await params;
  const result = getProjectsApplication().getProject(projectId);
  if (!result.ok) {
    if (result.error.kind === "not_found") {
      notFound();
    }
    return (
      <main className="grid min-h-screen place-items-center bg-[#f3ede1] px-6 text-center text-[#28241e]">
        <div className="max-w-md border border-[#cfc3b1] bg-[#fbf7ef] p-8">
          <h1 className="font-serif text-2xl font-semibold">
            暂时无法打开作品
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#6f675c]">
            {result.error.message}
          </p>
          <Link
            href="/"
            className={`${buttonVariants({ variant: "outline" })} mt-6 rounded-none`}
          >
            返回作品台
          </Link>
        </div>
      </main>
    );
  }
  return (
    <ProjectStudio
      initialProject={result.value}
    />
  );
}
