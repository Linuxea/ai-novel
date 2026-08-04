"use client";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { badgeVariants } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Loader2, Database } from "lucide-react";
import { toast } from "sonner";
import { useProjectStore } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";

const GENRES = ["玄幻", "科幻", "言情", "悬疑", "武侠", "都市", "历史", "其他"];

export function SettingsForm({
  defaultModel,
  embedConfigured,
}: {
  defaultModel: string;
  embedConfigured: boolean;
}) {
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
      embedConfigured={embedConfigured}
    />
  );
}

function SettingsFormInner({
  project,
  defaultModel,
  embedConfigured,
}: {
  project: Project;
  defaultModel: string;
  embedConfigured: boolean;
}) {
  const load = useProjectStore(useShallow((s) => s.load));
  const projectId = project.id;
  const [form, setForm] = useState({
    title: project.title,
    genre: project.genre,
    summary: project.summary,
    aiModel: project.aiModel || "",
    temperature: project.temperature ?? 0.8,
    ragMode: project.ragMode ?? "off",
    ragTopK: project.ragTopK ?? 6,
    generateStrategy: project.generateStrategy ?? "auto",
  });
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [ragChunks, setRagChunks] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getRagStatus(projectId)
      .then((res) => {
        if (!cancelled) setRagChunks(res.meta?.chunkCount ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleRebuild() {
    setRebuilding(true);
    try {
      const res = await api.rebuildRagIndex(projectId);
      setRagChunks(res.chunkCount);
      toast.success(`索引已重建（${res.chunkCount} 个片段）`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRebuilding(false);
    }
  }

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
              <button
                key={g}
                type="button"
                className={cn(
                  badgeVariants({
                    variant: form.genre === g ? "default" : "outline",
                  }),
                  "cursor-pointer",
                )}
                aria-pressed={form.genre === g}
                onClick={() => setForm({ ...form, genre: g })}
              >
                {g}
              </button>
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
            留空则使用全局默认模型（
            <code className="mx-0.5 rounded bg-muted px-1.5 py-0.5">
              {defaultModel}
            </code>
            ）；可填
            <code className="mx-0.5 rounded bg-muted px-1.5 py-0.5">
              deepseek-v4-pro
            </code>
            覆盖为更强模型
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>模型名称</Label>
          <Input
            value={form.aiModel}
            onChange={(e) => setForm({ ...form, aiModel: e.target.value })}
            placeholder="例如 deepseek-v4-pro"
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
        <div className="space-y-1.5">
          <Label>正文生成策略</Label>
          <Select
            value={form.generateStrategy}
            onValueChange={(v) =>
              setForm({
                ...form,
                generateStrategy: v as "auto" | "single" | "multi",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动（推荐）</SelectItem>
              <SelectItem value="single">单次生成（快、省）</SelectItem>
              <SelectItem value="multi">多步生成（规划分镜→逐段扩写，质量更高但耗时与成本约 3-4 倍）</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground/70">
            自动：重写走多步、续写大量已有正文时走单次。
          </p>
        </div>
      </Card>

      <Card className="mt-4 space-y-5 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Database className="h-4 w-4" />
            AI 检索（RAG）
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            生成章节时，从早期章节正文、世界观、剧情中检索相关片段注入，弥补长程记忆丢失。关闭则不检索。
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>检索模式</Label>
          <Select
            value={form.ragMode}
            onValueChange={(v) =>
              setForm({ ...form, ragMode: v as "off" | "bm25" | "embed" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">关闭</SelectItem>
              <SelectItem value="bm25">关键词检索（BM25，本地）</SelectItem>
              <SelectItem value="embed" disabled={!embedConfigured}>
                向量检索（embed）
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground/70">
            {embedConfigured
              ? "向量检索效果更好但需在重建索引时调用 embedding 端点。"
              : "向量检索需在 .env.local 配置 EMBED_API_KEY / EMBED_BASE_URL / EMBED_MODEL 后重启。"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>召回片段数（top-K）: {form.ragTopK}</Label>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={form.ragTopK}
            onChange={(e) =>
              setForm({ ...form, ragTopK: Number(e.target.value) })
            }
            className="w-full"
          />
        </div>
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            索引片段数：{ragChunks ?? "—"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRebuild}
            disabled={rebuilding}
          >
            {rebuilding ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="mr-2 h-3.5 w-3.5" />
            )}
            重建索引
          </Button>
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
