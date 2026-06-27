"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BookOpen, ArrowLeft } from "lucide-react";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { useProjectStore } from "@/lib/store";

export function ProjectShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const load = useProjectStore((s) => s.load);
  const project = useProjectStore((s) => s.project);

  useEffect(() => {
    load(projectId);
  }, [projectId, load]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Link
            href="/"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="返回作品列表"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">
            {project ? `《${project.title}》` : "加载中…"}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav projectId={projectId} />
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
