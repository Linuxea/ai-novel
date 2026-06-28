"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Pencil, Trash2, Compass } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  PLOT_STATUS_LABEL,
  PLOT_TYPE_META,
  type PlotNote,
  type PlotStatus,
  type PlotType,
} from "@/lib/types";

const TYPES = Object.entries(PLOT_TYPE_META) as [PlotType, { label: string; description: string }][];
const STATUSES = Object.entries(PLOT_STATUS_LABEL) as [PlotStatus, string][];

const STATUS_BADGE_CLASS: Record<PlotStatus, string> = {
  idea: "bg-muted text-muted-foreground",
  active: "bg-primary text-primary-foreground",
  resolved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

export default function PlanningPage() {
  const { project, plotNotes, upsertPlotNoteLocal, removePlotNoteLocal } =
    useProjectStore(
      useShallow((s) => ({
        project: s.project,
        plotNotes: s.plotNotes,
        upsertPlotNoteLocal: s.upsertPlotNoteLocal,
        removePlotNoteLocal: s.removePlotNoteLocal,
      })),
    );
  const projectId = project?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlotNote | null>(null);
  const [form, setForm] = useState({
    type: "plan" as PlotType,
    status: "idea" as PlotStatus,
    title: "",
    content: "",
  });
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm({ type: "plan", status: "idea", title: "", content: "" });
    setDialogOpen(true);
  }
  function openEdit(p: PlotNote) {
    setEditing(p);
    setForm({
      type: p.type,
      status: p.status,
      title: p.title,
      content: p.content,
    });
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
        ? await api.updatePlanning(projectId, editing!.id, form)
        : await api.upsertPlanning(projectId, form);
      upsertPlotNoteLocal(result.note);
      toast.success(isEdit ? "已更新" : "已创建");
      setDialogOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: PlotNote) {
    if (!confirm(`删除「${p.title}」？`)) return;
    try {
      await api.deletePlanning(projectId, p.id);
      removePlotNoteLocal(p.id);
      toast.success("已删除");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // 按类型分组
  const grouped = TYPES.map(([key, meta]) => ({
    key,
    label: meta.label,
    description: meta.description,
    items: plotNotes.filter((p) => p.type === key),
  })).filter((g) => g.items.length > 0);

  const pendingCount = plotNotes.filter((p) => p.status !== "resolved").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">剧情规划</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {plotNotes.length} 条 · 待收束 {pendingCount} 条
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建规划
          </Button>
        </header>

        {plotNotes.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
            <Compass className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有剧情规划。可记录故事线、伏笔、转折与后续走向，让 AI
              在清空对话后仍记得这些长期规划
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {grouped.map((g) => (
              <section key={g.key}>
                <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  {g.label}
                  <span className="text-muted-foreground/60">
                    ({g.items.length})
                  </span>
                </h2>
                <p className="mb-3 pl-4 text-xs text-muted-foreground/70">
                  {g.description}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.items.map((p) => (
                    <Card key={p.id} className="group relative p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium">{p.title}</h3>
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => openEdit(p)}
                            className="rounded p-1 hover:bg-muted"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="rounded p-1 hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2">
                        <Badge
                          className={STATUS_BADGE_CLASS[p.status]}
                          variant="secondary"
                        >
                          {PLOT_STATUS_LABEL[p.status]}
                        </Badge>
                      </div>
                      {p.content && (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                          {p.content}
                        </p>
                      )}
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
            <DialogTitle>{editing ? "编辑规划" : "新建规划"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>类型</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm({ ...form, type: v as PlotType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map(([key, meta]) => (
                      <SelectItem key={key} value={key}>
                        {meta.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>状态</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as PlotStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
