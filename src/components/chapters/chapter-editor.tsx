"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  Sparkles,
  Eye,
  Pencil,
  Square,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ChapterStatus } from "@/lib/types";

export function ChapterEditor({
  projectId,
  chapterId,
}: {
  projectId: string;
  chapterId: string;
}) {
  const { chapters, upsertChapterLocal } = useProjectStore();
  const chapter = chapters.find((c) => c.id === chapterId);

  const [content, setContent] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [dirty, setDirty] = useState(false);

  // 加载章节内容
  useEffect(() => {
    api.getChapterContent(projectId, chapterId).then((res) => {
      setContent(res.content || "");
      setLoaded(true);
    });
  }, [projectId, chapterId]);

  function handleChange(v: string) {
    setContent(v);
    setDirty(true);
  }

  async function handleSave(silent = false) {
    if (!loaded) return;
    setSaving(true);
    try {
      await api.saveChapterContent(projectId, chapterId, content);
      setDirty(false);
      // 刷新 store 中的字数/状态
      upsertChapterLocal({
        ...chapter!,
        wordCount: content.replace(/\s+/g, "").length,
      });
      if (!silent) toast.success("已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // 自动保存（失焦或停顿）
  useEffect(() => {
    if (!loaded || !dirty) return;
    const timer = setTimeout(() => handleSave(true), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, loaded]);

  async function handleGenerate(append: boolean) {
    if (generating) {
      abortRef.current?.abort();
      return;
    }
    if (append && !content.trim()) {
      toast.error("当前没有正文可续写，将生成完整章节");
    }
    setGenerating(true);
    if (!append) {
      setTab("write");
      if (content.trim() && !confirm("将覆盖当前正文，确定重新生成？")) {
        setGenerating(false);
        return;
      }
      setContent("");
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/generate`,
        { method: "POST", signal: controller.signal },
      );
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "生成失败");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = append ? content : "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        acc += chunk;
        setContent(acc);
      }
      toast.success("生成完成");
      // 保存
      await api.saveChapterContent(projectId, chapterId, acc);
      upsertChapterLocal({
        ...chapter!,
        wordCount: acc.replace(/\s+/g, "").length,
        status: "drafting",
      });
      setDirty(false);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error((e as Error).message);
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  async function setStatus(status: ChapterStatus) {
    try {
      const { chapter: updated } = await api.updateChapter(
        projectId,
        chapterId,
        { status },
      );
      upsertChapterLocal(updated);
      toast.success("已更新状态");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!chapter) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        章节不存在
      </div>
    );
  }

  const wordCount = content.replace(/\s+/g, "").length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}/chapters`}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 font-semibold">
              第{chapter.order}章 · {chapter.title}
              {chapter.status === "done" && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {generating ? (
            <Button variant="outline" size="sm" onClick={() => handleGenerate(false)}>
              <Square className="mr-2 h-3.5 w-3.5" />
              停止
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleGenerate(true)}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5 text-violet-500" />
                续写
              </Button>
              <Button size="sm" onClick={() => handleGenerate(false)}>
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                AI 生成
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSave(false)}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </header>

      {/* 大纲提示 */}
      {chapter.outline && (
        <div className="border-b bg-muted/30 px-6 py-2 text-xs text-muted-foreground">
          <span className="font-medium">大纲：</span>
          {chapter.outline}
        </div>
      )}

      {/* 编辑器 / 预览 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b px-6 py-2">
          <div className="flex gap-1">
            <Button
              variant={tab === "write" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("write")}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              编辑
            </Button>
            <Button
              variant={tab === "preview" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("preview")}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              预览
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {wordCount.toLocaleString()} 字
              {dirty ? " · 未保存" : ""}
            </span>
            <Badge variant="outline" className="cursor-pointer text-xs">
              <select
                value={chapter.status}
                onChange={(e) => setStatus(e.target.value as ChapterStatus)}
                className="bg-transparent outline-none"
              >
                <option value="outline">大纲</option>
                <option value="drafting">写作中</option>
                <option value="done">已完成</option>
              </select>
            </Badge>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "write" ? (
            <Textarea
              value={content}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={() => dirty && handleSave(true)}
              placeholder="在此撰写正文，或点击「AI 生成」让 AI 帮你写…"
              className={cn(
                "h-full min-h-full resize-none rounded-none border-0 font-serif text-base leading-loose focus-visible:ring-0",
                "px-[15%] py-8",
              )}
            />
          ) : (
            <div className="px-[15%] py-8">
              {content.trim() ? (
                <div className="prose prose-lg max-w-none whitespace-pre-wrap font-serif leading-loose dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-muted-foreground">还没有正文内容</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
