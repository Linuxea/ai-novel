"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Plus, Trash2, Clock, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";

const GENRES = ["玄幻", "科幻", "言情", "悬疑", "武侠", "都市", "历史", "其他"];

export function ProjectList({ initialProjects }: { initialProjects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    genre: "玄幻",
    summary: "",
  });

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/projects/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");
      toast.success(`已导入《${data.project.title}》`);
      router.push(`/projects/${data.project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setImporting(false);
    }
  }

  async function handleCreate() {
    if (!form.title.trim()) {
      toast.error("请输入书名");
      return;
    }
    setCreating(true);
    try {
      const { project } = await api.createProject(form);
      toast.success("已创建项目");
      router.push(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除该项目及其所有数据？此操作不可撤销。")) return;
    try {
      await api.deleteProject(id);
      setProjects((p) => p.filter((x) => x.id !== id));
      toast.success("已删除");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-violet-50/40 to-background">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-12 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <BookOpen className="h-8 w-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">墨章</h1>
          <p className="mt-3 text-muted-foreground">
            与 AI 协作，从零构建你的小说世界
          </p>
        </header>

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">我的作品</h2>
          <div className="flex gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-input bg-background text-sm font-medium hover:bg-muted h-8 px-3">
              <Upload className="h-4 w-4" />
              {importing ? "导入中…" : "导入"}
              <input
                type="file"
                accept=".zip"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImport(f);
                  e.target.value = "";
                }}
              />
            </label>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新建作品
            </Button>
          </div>
        </div>

        {projects.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-4 border-dashed py-20 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium">还没有作品</p>
              <p className="mt-1 text-sm text-muted-foreground">
                点击「新建作品」开始你的第一部小说
              </p>
            </div>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新建作品
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="group relative flex flex-col gap-3 p-5 transition-shadow hover:shadow-md"
              >
                <Link href={`/projects/${p.id}`} className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-tight hover:text-primary">
                      《{p.title}》
                    </h3>
                  </div>
                  <Badge variant="secondary" className="mt-2">
                    {p.genre}
                  </Badge>
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {p.summary || "（暂无简介）"}
                  </p>
                  <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground/70">
                    <Clock className="h-3 w-3" />
                    {formatDate(p.updatedAt)}
                  </p>
                </Link>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  aria-label="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建作品</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="title">书名</Label>
              <Input
                id="title"
                placeholder="例如：青衫客"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>题材</Label>
              <div className="flex flex-wrap gap-2">
                {GENRES.map((g) => (
                  <Badge
                    key={g}
                    variant={form.genre === g ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setForm({ ...form, genre: g })}
                  >
                    {g}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="summary">简介（选填）</Label>
              <Textarea
                id="summary"
                placeholder="简单描述你想写的故事……"
                rows={3}
                value={form.summary}
                onChange={(e) =>
                  setForm({ ...form, summary: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "创建中…" : "创建并开始"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
