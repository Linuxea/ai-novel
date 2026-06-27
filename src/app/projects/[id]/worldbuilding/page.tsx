"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Pencil, Trash2, Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useProjectStore } from "@/lib/store";
import { api } from "@/lib/api";
import {
  WORLD_CATEGORY_LABEL,
  type WorldCategory,
  type WorldSection,
} from "@/lib/types";

const CATEGORIES = Object.entries(WORLD_CATEGORY_LABEL) as [
  WorldCategory,
  string,
][];

export default function WorldbuildingPage() {
  const { project, worldbuilding, upsertWorldLocal, removeWorldLocal } =
    useProjectStore(
      useShallow((s) => ({
        project: s.project,
        worldbuilding: s.worldbuilding,
        upsertWorldLocal: s.upsertWorldLocal,
        removeWorldLocal: s.removeWorldLocal,
      })),
    );
  const projectId = project?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorldSection | null>(null);
  const [form, setForm] = useState({
    category: "geography" as WorldCategory,
    title: "",
    content: "",
  });
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm({ category: "geography", title: "", content: "" });
    setDialogOpen(true);
  }
  function openEdit(w: WorldSection) {
    setEditing(w);
    setForm({ category: w.category, title: w.title, content: w.content });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error("请输入标题");
      return;
    }
    setSaving(true);
    try {
      const isEdit = !!editing?.id;
      const result = isEdit
        ? await api.updateWorld(projectId, editing!.id, form)
        : await api.upsertWorld(projectId, form);
      upsertWorldLocal(result.section);
      toast.success(isEdit ? "已更新" : "已创建");
      setDialogOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(w: WorldSection) {
    if (!confirm(`删除「${w.title}」？`)) return;
    try {
      await api.deleteWorld(projectId, w.id);
      removeWorldLocal(w.id);
      toast.success("已删除");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // 按分类分组
  const grouped = CATEGORIES.map(([key, label]) => ({
    key,
    label,
    items: worldbuilding.filter((w) => w.category === key),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">世界观</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {worldbuilding.length} 条设定
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建条目
          </Button>
        </header>

        {worldbuilding.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
            <Globe className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有世界观设定，点击「新建条目」或在 AI 对话中探讨
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {grouped.map((g) => (
              <section key={g.key}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  {g.label}
                  <span className="text-muted-foreground/60">
                    ({g.items.length})
                  </span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.items.map((w) => (
                    <Card key={w.id} className="group relative p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium">{w.title}</h3>
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => openEdit(w)}
                            className="rounded p-1 hover:bg-muted"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(w)}
                            className="rounded p-1 hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {w.content}
                      </p>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑条目" : "新建条目"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>分类</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm({ ...form, category: v as WorldCategory })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>标题 *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>内容</Label>
              <Textarea
                rows={6}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
