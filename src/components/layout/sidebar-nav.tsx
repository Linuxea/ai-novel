"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessagesSquare,
  Users,
  GitFork,
  Globe,
  ScrollText,
  BookText,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "", label: "概览", icon: LayoutDashboard },
  { href: "/chat", label: "AI 对话", icon: MessagesSquare },
  { href: "/characters", label: "角色", icon: Users },
  { href: "/relationships", label: "关系图谱", icon: GitFork },
  { href: "/worldbuilding", label: "世界观", icon: Globe },
  { href: "/plot", label: "剧情", icon: ScrollText },
  { href: "/chapters", label: "章节", icon: BookText },
  { href: "/settings", label: "设置", icon: Settings },
];

export function SidebarNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {NAV.map((item) => {
        const href = `${base}${item.href}`;
        const active =
          item.href === ""
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
