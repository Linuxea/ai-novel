"use client";

import Link from "next/link";
import {
  Users,
  Globe,
  ScrollText,
  BookText,
  MessagesSquare,
  GitFork,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProjectStore } from "@/lib/store";

export default function OverviewPage() {
  return <OverviewContent />;
}

function OverviewContent() {
  const { project, characters, worldbuilding, plot, chapters } =
    useProjectStore();
  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  const stats = [
    { label: "角色", value: characters.length, icon: Users, href: "characters" },
    {
      label: "世界观",
      value: worldbuilding.length,
      icon: Globe,
      href: "worldbuilding",
    },
    { label: "剧情节点", value: plot.length, icon: ScrollText, href: "plot" },
    { label: "章节", value: chapters.length, icon: BookText, href: "chapters" },
  ];

  const projectId = project?.id ?? "";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">
            《{project?.title ?? "…"}》
          </h1>
          <div className="mt-2 flex items-center gap-3">
            <Badge variant="secondary">{project?.genre}</Badge>
            <span className="text-sm text-muted-foreground">
              总字数 {totalWords.toLocaleString()}
            </span>
          </div>
          {project?.summary && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {project.summary}
            </p>
          )}
        </header>

        <div className="mb-8">
          <Link
            href={`/projects/${projectId}/chat`}
            className={buttonVariants()}
          >
            <MessagesSquare className="mr-2 h-4 w-4" />
            开始与 AI 对话构建
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.label} href={`/projects/${projectId}/${s.href}`}>
                <Card className="flex flex-col gap-2 p-5 transition-shadow hover:shadow-md">
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-2xl font-bold">{s.value}</span>
                  <span className="text-sm text-muted-foreground">
                    {s.label}
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="mt-8">
          <Link
            href={`/projects/${projectId}/relationships`}
            className={buttonVariants({ variant: "outline" })}
          >
            <GitFork className="mr-2 h-4 w-4" />
            查看角色关系图谱
          </Link>
        </div>
      </div>
    </div>
  );
}
