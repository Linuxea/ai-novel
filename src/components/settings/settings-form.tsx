"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useProjectStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";

const GENRES = ["玄幻", "科幻", "言情", "悬疑", "武侠", "都市", "历史", "其他"];

export function SettingsForm({ defaultModel }: { defaultModel: string }) {
  const project = useProjectStore((s) => s.project);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中…
      </div>
    );
  }

  return (
    <SettingsFormInner
      key={project.id}
      project={project}
      defaultModel={defaultModel}
    />
  );
}

function SettingsFormInner({
  project,
  defaultModel,
}: {
  project: Project;
  defaultModel: string;
}) {
  const { load } = useProjectStore();
  const projectId = project.id;
  const [form, setForm] = useState({
    title: project.title,
    genre: project.genre,
    summary: project.summary,
    aiModel: project.aiModel || "",
    temperature: project.temperature ?? 0.8,
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error("请输入书名");
      return;
    }
    setSaving(true);
    try {
      await api.updateProject(projectId, form);
      await load(projectId);
      toast.success("已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("确定删除整个项目及其所有数据？此操作不可撤销！")) return;
    await api.deleteProject(projectId);
    window.location.href = "/";
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <h1 className="mb-6 text-xl font-bold">设置</h1>

      <Card className="space-y-5 p-6">
        <h2 className="text-sm font-semibold">基本信息</h2>
        <div className="space-y-1.5">
          <Label>书名</Label>
          <Input
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
        <div className="space-y-1.5">
          <Label>简介</Label>
          <Textarea
            rows={3}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </div>
      </Card>

      <Card className="mt-4 space-y-5 p-6">
        <div>
          <h2 className="text-sm font-semibold">AI 模型</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            留空则使用全局默认模型：
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5">
              {defaultModel || "（未配置）"}
            </code>
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>模型名称</Label>
          <Input
            value={form.aiModel}
            onChange={(e) => setForm({ ...form, aiModel: e.target.value })}
            placeholder="例如 deepseek-chat"
          />
        </div>
        <div className="space-y-1.5">
          <Label>创造力（温度）: {form.temperature.toFixed(1)}</Label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.1}
            value={form.temperature}
            onChange={(e) =>
              setForm({ ...form, temperature: Number(e.target.value) })
            }
            className="w-full"
          />
        </div>
      </Card>

      <Card className="mt-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">备份与导出</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              导出整个项目为 zip（含全部设定、角色关系与章节正文）
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = `/api/projects/${projectId}/export`;
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            导出项目
          </Button>
        </div>
      </Card>

      <div className="mt-6 flex justify-between">
        <Button variant="destructive" onClick={handleDelete}>
          删除项目
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : "保存设置"}
        </Button>
      </div>
    </div>
  );
}
