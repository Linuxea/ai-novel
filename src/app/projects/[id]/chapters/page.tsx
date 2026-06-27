"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2, BookText, FileText, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useProjectStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { ChapterStatus } from "@/lib/types";

const STATUS_META: Record<ChapterStatus, { label: string; variant: "outline" | "secondary" | "default" }> = {
  outline: { label: "大纲", variant: "outline" },
  drafting: { label: "写作中", variant: "secondary" },
  done: { label: "已完成", variant: "default" },
};

export default function ChaptersPage() {
  const { project, chapters, upsertChapterLocal, removeChapterLocal } =
    useProjectStore();
  const projectId = project?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ title: "", outline: "" });
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setForm({ title: "", outline: "" });
    setDialogOpen(true);
  }

  async function handleCreate() {
    if (!form.title.trim()) {
      toast.error("请输入章节标题");
      return;
    }
    setSaving(true);
    try {
      const { chapter } = await api.upsertChapter(projectId, {
        title: form.title,
        outline: form.outline,
        status: "outline",
      });
      upsertChapterLocal(chapter);
      toast.success("已创建章节");
      setDialogOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(chapterId: string, title: string) {
    if (!confirm(`删除章节「${title}」？`)) return;
    try {
      await api.deleteChapter(projectId, chapterId);
      removeChapterLocal(chapterId);
      toast.success("已删除");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">章节</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {chapters.length} 章 · 总字数{" "}
              {chapters
                .reduce((s, c) => s + (c.wordCount || 0), 0)
                .toLocaleString()}
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建章节
          </Button>
        </header>

        {chapters.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
            <BookText className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有章节，与 AI 对话规划章节大纲，或点击「新建章节」
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {chapters.map((c) => {
              const meta = STATUS_META[c.status];
              return (
                <Card key={c.id} className="group flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
                    {c.order}
                  </div>
                  <Link
                    href={`/projects/${projectId}/chapters/${c.id}`}
                    className="flex-1"
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium hover:text-primary">
                        {c.title}
                      </h3>
                      <Badge variant={meta.variant} className="text-xs">
                        {meta.label}
                      </Badge>
                    </div>
                    {c.outline && (
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                        {c.outline}
                      </p>
                    )}
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/70">
                      <FileText className="h-3 w-3" />
                      {(c.wordCount || 0).toLocaleString()} 字
                      {c.status === "done" && (
                        <CheckCircle2 className="ml-2 h-3 w-3 text-green-500" />
                      )}
                    </p>
                  </Link>
                  <button
                    onClick={() => handleDelete(c.id, c.title)}
                    className="rounded p-2 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-8">
          {project && (
            <Link
              href={`/projects/${projectId}/chat`}
              className={buttonVariants({ variant: "outline" })}
            >
              在 AI 对话中规划章节
            </Link>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建章节</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>标题 *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="例如：风起青萍"
              />
            </div>
            <div className="space-y-1.5">
              <Label>大纲</Label>
              <Textarea
                rows={4}
                value={form.outline}
                onChange={(e) => setForm({ ...form, outline: e.target.value })}
                placeholder="本章主要情节…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
