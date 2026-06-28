"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BookOpen, ArrowLeft, AlertCircle } from "lucide-react";
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
  const error = useProjectStore((s) => s.error);

  useEffect(() => {
    load(projectId);
  }, [projectId, load]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold">数据加载失败</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          <Link href="/" className="text-sm text-primary hover:underline">
            返回作品列表
          </Link>
        </div>
      </div>
    );
  }

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
