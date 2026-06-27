"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { useProjectStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { PlotPoint } from "@/lib/types";

export default function PlotPage() {
  const { project, plot, upsertPlotLocal, removePlotLocal } =
    useProjectStore();
  const projectId = project?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlotPoint | null>(null);
  const [form, setForm] = useState({
    act: 1,
    order: 1,
    title: "",
    summary: "",
  });
  const [saving, setSaving] = useState(false);

  const charName = (id: string) =>
    useProjectStore.getState().characters.find((c) => c.id === id)?.name ?? "";

  function openCreate() {
    const maxAct = plot.reduce((m, p) => Math.max(m, p.act), 1);
    setEditing(null);
    setForm({
      act: maxAct,
      order: plot.filter((p) => p.act === maxAct).length + 1,
      title: "",
      summary: "",
    });
    setDialogOpen(true);
  }
  function openEdit(p: PlotPoint) {
    setEditing(p);
    setForm({
      act: p.act,
      order: p.order,
      title: p.title,
      summary: p.summary,
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
        ? await api.updatePlot(projectId, editing!.id, form)
        : await api.upsertPlot(projectId, form);
      upsertPlotLocal(result.plot);
      toast.success(isEdit ? "已更新" : "已创建");
      setDialogOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: PlotPoint) {
    if (!confirm(`删除剧情节点「${p.title}」？`)) return;
    try {
      await api.deletePlot(projectId, p.id);
      removePlotLocal(p.id);
      toast.success("已删除");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const acts = [...new Set(plot.map((p) => p.act))].sort((a, b) => a - b);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">剧情大纲</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {plot.length} 个剧情节点
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建节点
          </Button>
        </header>

        {plot.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有剧情节点，与 AI 探讨故事走向时会自动记录
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {acts.map((act) => (
              <section key={act}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  第 {act} 幕
                </h2>
                <div className="space-y-3 border-l-2 border-muted pl-5">
                  {plot
                    .filter((p) => p.act === act)
                    .sort((a, b) => a.order - b.order)
                    .map((p) => (
                      <Card key={p.id} className="group relative p-4">
                        <div className="absolute -left-[27px] top-6 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {p.order}
                              </Badge>
                              <h3 className="font-medium">{p.title}</h3>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                              {p.summary}
                            </p>
                            {p.characterIds && p.characterIds.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {p.characterIds.map((id) => (
                                  <Badge
                                    key={id}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {charName(id)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
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
            <DialogTitle>{editing ? "编辑节点" : "新建节点"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>幕</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.act}
                  onChange={(e) =>
                    setForm({ ...form, act: Number(e.target.value) || 1 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>顺序</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.order}
                  onChange={(e) =>
                    setForm({ ...form, order: Number(e.target.value) || 1 })
                  }
                />
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
              <Label>梗概</Label>
              <Textarea
                rows={4}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
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
