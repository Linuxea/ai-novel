"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
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
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api";
import { useProjectStore, useProjectStoreApi } from "@/lib/store";
import { cn } from "@/lib/utils";
import { classifyDuePlotNotes } from "@/lib/plot-due";
import { parseGenerationEvent } from "@/lib/ai/generation-events";
import {
  FINDING_CATEGORY_META,
  SEVERITY_META,
  type ChapterStatus,
  type ConsistencyReport,
} from "@/lib/types";

const REMARK_PLUGINS = [remarkGfm];

export function ChapterEditor({
  projectId,
  chapterId,
}: {
  projectId: string;
  chapterId: string;
}) {
  const storeApi = useProjectStoreApi();
  const {
    chapters,
    characters,
    plotNotes,
    commitChapterLocal,
    commitPlotNoteLocal,
    replacePlotNotesLocal,
    upsertChapterLocal,
  } =
    useProjectStore(
      useShallow((s) => ({
        chapters: s.chapters,
        characters: s.characters,
        plotNotes: s.plotNotes,
        commitChapterLocal: s.commitChapterLocal,
        commitPlotNoteLocal: s.commitPlotNoteLocal,
        replacePlotNotesLocal: s.replacePlotNotesLocal,
        upsertChapterLocal: s.upsertChapterLocal,
      })),
    );
  const chapter = chapters.find((c) => c.id === chapterId);

  const dueInThisChapter = useMemo(
    () => (chapter ? classifyDuePlotNotes(plotNotes, chapter.order) : null),
    [plotNotes, chapter],
  );
  const dueCount = dueInThisChapter
    ? dueInThisChapter.mustResolve.length + dueInThisChapter.mustPlant.length
    : 0;

  const [content, setContent] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const loaded = loadState === "ready";
  const [generationDraft, setGenerationDraft] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [generationIncomplete, setGenerationIncomplete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef("");
  const generationDraftRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const [contentRevision, setContentRevision] = useState(0);
  const [persistedContentHash, setPersistedContentHash] = useState("");
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const [dirty, setDirty] = useState(false);

  // 一致性检查
  const [checkReport, setCheckReport] =
    useState<ConsistencyReport | null>(null);
  const [checkStaleFromServer, setCheckStaleFromServer] = useState(false);
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);

  // 大纲内联编辑
  const [outlineEditing, setOutlineEditing] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState("");
  const [outlineSaving, setOutlineSaving] = useState(false);
  const [outlineSyncing, setOutlineSyncing] = useState(false);

  // 备注内联编辑
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  // 加载章节内容
  useEffect(() => {
    let cancelled = false;
    api
      .getChapterContent(projectId, chapterId)
      .then((res) => {
        if (cancelled) return;
        const next = res.content || "";
        contentRef.current = next;
        setContent(next);
        revisionRef.current = res.contentRevision;
        setContentRevision(res.contentRevision);
        setPersistedContentHash(res.contentHash);
        setLoadState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error((e as Error).message);
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, chapterId]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // 卸载时中止在途的 AI 生成
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleChange(v: string) {
    contentRef.current = v;
    setContent(v);
    setDirty(true);
    setGenerationIncomplete(false);
  }

  // 保存串行化：自动保存（debounce/blur）与生成后保存可能并发，
  // 若不排队，后到服务器的旧快照会覆盖新内容（last-write-wins）
  const saveContent = useCallback(
    (snapshot: string, silent = false): Promise<(typeof chapter) | null> => {
      if (!loaded || !chapter) return Promise.resolve(null);
      const run = saveChainRef.current.then(async (): Promise<
        (typeof chapter) | null
      > => {
        setSaving(true);
        try {
          const { project, chapter: savedChapter } = await api.saveChapterContent(
            projectId,
            chapterId,
            snapshot,
            revisionRef.current,
          );
          revisionRef.current = savedChapter.contentRevision;
          setContentRevision(savedChapter.contentRevision);
          setPersistedContentHash(savedChapter.contentHash);
          if (contentRef.current === snapshot) setDirty(false);
          commitChapterLocal(project, savedChapter);
          if (!silent) toast.success("已保存");
          return savedChapter;
        } catch (e) {
          if (e instanceof ApiClientError && e.code === "REVISION_CONFLICT") {
            toast.error("正文已在其他页面更新，当前草稿未覆盖服务器内容");
          } else {
            toast.error((e as Error).message);
          }
          return null;
        } finally {
          setSaving(false);
        }
      });
      saveChainRef.current = run;
      return run;
    },
    [chapter, chapterId, commitChapterLocal, loaded, projectId],
  );

  async function handleSave(silent = false) {
    const saved = await saveContent(contentRef.current, silent);
    if (saved) {
      setGenerationIncomplete(false);
      if (!silent) void triggerSummary(saved.contentRevision);
    }
    return saved;
  }

  // 触发章节摘要生成（服务端落盘）。失败静默降级，绝不影响写作流程。
  const triggerSummary = useCallback(
    async (expectedContentRevision: number, force = false) => {
      if (!chapter) return;
      try {
        const res = await api.summarizeChapter(
          projectId,
          chapterId,
          expectedContentRevision,
          force,
        );
        if (
          revisionRef.current !== res.contentRevision ||
          storeApi.getState().projectId !== projectId
        ) {
          return;
        }
        const latest = storeApi
          .getState()
          .chapters.find((item) => item.id === chapterId);
        if (!latest) return;
        upsertChapterLocal({
          ...latest,
          summary: res.chapter.summary,
          summaryOfContentHash: res.chapter.summaryOfContentHash,
          summaryInputFingerprint: res.chapter.summaryInputFingerprint,
          summaryPromptVersion: res.chapter.summaryPromptVersion,
          summaryGeneratedAt: res.chapter.summaryGeneratedAt,
        });
      } catch {
        // 静默：摘要失败不影响写作
      }
    },
    [chapter, chapterId, projectId, storeApi, upsertChapterLocal],
  );

  // 挂载时取最近一次缓存的一致性检查报告
  useEffect(() => {
    let cancelled = false;
    api
      .getCheck(projectId, chapterId)
      .then((res) => {
        if (!cancelled) {
          setCheckReport(res.report);
          setCheckStaleFromServer(res.stale);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, chapterId]);

  // 运行一致性检查（非阻塞）；失败不影响正文提交。
  const runCheck = useCallback(async (committedRevision?: number) => {
    setCheckRunning(true);
    try {
      let expectedContentRevision = committedRevision ?? revisionRef.current;
      if (committedRevision == null && dirty) {
        const saved = await saveContent(contentRef.current, true);
        if (!saved) return;
        expectedContentRevision = saved.contentRevision;
      }
      const res = await api.runCheck(
        projectId,
        chapterId,
        expectedContentRevision,
      );
      if (revisionRef.current !== res.report.contentRevision) return;
      setCheckReport(res.report);
      setCheckStaleFromServer(false);
      replacePlotNotesLocal(res.project, res.plotNotes);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "REVISION_CONFLICT"
      ) {
        toast.info("检查期间正文或设定已变化，旧结果已丢弃");
      } else {
        toast.error((error as Error).message);
      }
    } finally {
      setCheckRunning(false);
    }
  }, [chapterId, dirty, projectId, replacePlotNotesLocal, saveContent]);

  async function markForeshadowResolved(plotNoteId: string) {
    try {
      const { project, note } = await api.resolvePlanning(
        projectId,
        plotNoteId,
        chapterId,
      );
      commitPlotNoteLocal(project, note);
      toast.success("已标记为已回收");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // 自动保存（失焦或停顿）
  useEffect(() => {
    if (
      !loaded ||
      !dirty ||
      generating ||
      generationDraft !== null ||
      generationIncomplete
    ) {
      return;
    }
    const snapshot = content;
    const timer = setTimeout(() => saveContent(snapshot, true), 2000);
    return () => clearTimeout(timer);
  }, [
    content,
    dirty,
    generating,
    generationDraft,
    generationIncomplete,
    loaded,
    saveContent,
  ]);

  async function handleGenerate(append: boolean) {
    if (generating) {
      abortRef.current?.abort();
      return;
    }
    if (append && dirty && !(await handleSave(true))) return;
    const baseContent = contentRef.current;
    if (append && !baseContent.trim()) {
      toast.error("当前没有正文可续写，将生成完整章节");
    }
    setGenerating(true);
    if (!append) {
      setTab("write");
      if (baseContent.trim() && !confirm("将覆盖当前正文，确定重新生成？")) {
        setGenerating(false);
        return;
      }
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const initialDraft = append ? baseContent : "";
    generationDraftRef.current = initialDraft;
    setGenerationDraft(initialDraft);
    setGenerationProgress(null);
    setGenerationIncomplete(false);
    let completed = false;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/generate?mode=${append ? "continue" : "regenerate"}&revision=${revisionRef.current}`,
        { method: "POST", signal: controller.signal },
      );
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "生成失败");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let acc = initialDraft;

      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const event = parseGenerationEvent(line);
        if (event.type === "delta") {
          acc += event.text;
          generationDraftRef.current = acc;
          setGenerationDraft(acc);
        } else if (event.type === "progress") {
          setGenerationProgress({
            current: event.current,
            total: event.total,
          });
        } else if (event.type === "error") {
          const error = new Error(event.message);
          if (event.code === "ABORTED") error.name = "AbortError";
          throw error;
        } else if (event.type === "done") {
          completed = true;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      }
      pending += decoder.decode();
      if (pending.trim()) consumeLine(pending);
      if (!completed) throw new Error("生成未完整结束，结果未保存");

      contentRef.current = acc;
      setContent(acc);
      setDirty(true);
      const saved = await saveContent(acc, true);
      if (saved) {
        setGenerationIncomplete(false);
        setGenerationDraft(null);
        generationDraftRef.current = null;
        toast.success("生成完成并已保存");
        void triggerSummary(saved.contentRevision);
        void runCheck(saved.contentRevision);
      } else {
        setGenerationIncomplete(true);
      }
    } catch (e) {
      const draft = generationDraftRef.current;
      if (draft !== null && draft !== initialDraft) {
        contentRef.current = draft;
        setContent(draft);
        setDirty(true);
        setGenerationIncomplete(true);
      }
      if ((e as Error).name !== "AbortError") {
        toast.error((e as Error).message);
      }
    } finally {
      setGenerationDraft(null);
      generationDraftRef.current = null;
      setGenerationProgress(null);
      setGenerating(false);
      abortRef.current = null;
    }
  }

  async function setStatus(status: ChapterStatus) {
    try {
      const { project, chapter: updated } = await api.updateChapter(
        projectId,
        chapterId,
        { status },
      );
      commitChapterLocal(project, updated);
      toast.success("已更新状态");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function startOutlineEdit() {
    setOutlineDraft(chapter?.outline ?? "");
    setOutlineEditing(true);
  }

  async function saveOutline() {
    if (!chapter) return;
    setOutlineSaving(true);
    try {
      const { project, chapter: updated } = await api.updateChapter(
        projectId,
        chapterId,
        { outline: outlineDraft },
      );
      commitChapterLocal(project, updated);
      setOutlineEditing(false);
      toast.success("大纲已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOutlineSaving(false);
    }
  }

  async function handleSyncOutline() {
    if (!chapter) return;
    if (dirty && !(await handleSave(true))) return;
    const currentContent = contentRef.current;
    if (!currentContent.trim()) {
      toast.error("正文为空，无法同步");
      return;
    }
    if (
      chapter.outline?.trim() &&
      !confirm("将根据当前正文重新生成大纲，覆盖现有大纲？")
    ) {
      return;
    }
    setOutlineSyncing(true);
    try {
      const { project, chapter: updated } = await api.syncOutline(
        projectId,
        chapterId,
        revisionRef.current,
      );
      if (!updated.outline) {
        toast.warning("未能生成大纲，请稍后重试");
        return;
      }
      commitChapterLocal(project, updated);
      toast.success("大纲已从正文同步");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOutlineSyncing(false);
    }
  }

  async function toggleCharacter(id: string) {
    if (!chapter) return;
    const current = chapter.characterIds ?? [];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    try {
      const { project, chapter: updated } = await api.updateChapter(
        projectId,
        chapterId,
        { characterIds: next },
      );
      commitChapterLocal(project, updated);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function startNotesEdit() {
    setNotesDraft(chapter?.notes ?? "");
    setNotesEditing(true);
  }

  async function saveNotes() {
    if (!chapter) return;
    setNotesSaving(true);
    try {
      const { project, chapter: updated } = await api.updateChapter(
        projectId,
        chapterId,
        { notes: notesDraft },
      );
      commitChapterLocal(project, updated);
      setNotesEditing(false);
      toast.success("备注已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setNotesSaving(false);
    }
  }

  const visibleContent = generationDraft ?? content;
  const wordCount = useMemo(
    () => visibleContent.replace(/\s+/g, "").length,
    [visibleContent],
  );

  const checkIsStale = !!checkReport && (
    checkStaleFromServer ||
    dirty ||
    checkReport.contentRevision !== contentRevision ||
    checkReport.contentHash !== persistedContentHash
  );

  const significantFindings = (checkReport?.findings ?? []).filter(
    (f) => f.severity === "high" || f.severity === "medium",
  );

  function renderCheckBadge() {
    if (checkRunning) {
      return (
        <span
          className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
          title="一致性检查进行中"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          检查中
        </span>
      );
    }
    if (!checkReport) return null;
    if (checkIsStale) {
      return (
        <button
          onClick={() => void runCheck()}
          className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
          title="正文已变化，点击重新检查"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          检查已过期
        </button>
      );
    }
    if (checkReport.error) {
      return (
        <button
          onClick={() => void runCheck()}
          className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
          title={`检查失败：${checkReport.error}（点击重试）`}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          检查失败
        </button>
      );
    }
    if (significantFindings.length === 0) {
      return (
        <span
          className="flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400"
          title={checkReport.summary}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          检查通过
        </span>
      );
    }
    return (
      <button
        onClick={() => setCheckOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-normal text-amber-600 hover:underline dark:text-amber-400"
        title="点击查看一致性检查发现"
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        {significantFindings.length} 个潜在问题
      </button>
    );
  }

  if (!chapter) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        章节不存在
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}/chapters`}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label="返回章节列表"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 font-semibold">
              第{chapter.order}章 · {chapter.title}
              {chapter.status === "done" && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              {renderCheckBadge()}
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
                disabled={!loaded}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5 text-violet-500" />
                续写
              </Button>
              <Button
                size="sm"
                onClick={() => handleGenerate(false)}
                disabled={!loaded}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                {content.trim() ? "重新生成" : "AI 生成"}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSave(false)}
            disabled={saving || !loaded || generating}
            aria-label="保存正文"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </header>

      {dueCount > 0 && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-6 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            本章有 {dueCount} 条到期伏笔需处理（
            {dueInThisChapter!.mustResolve.length} 待回收 ·{" "}
            {dueInThisChapter!.mustPlant.length} 待埋设），生成时将自动提示 AI
            织入
          </span>
        </div>
      )}

      {/* 大纲 */}
      <div className="border-b bg-muted/30 px-6 py-2 text-xs">
        {outlineEditing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={outlineDraft}
              onChange={(e) => setOutlineDraft(e.target.value)}
              placeholder="本章主要情节…"
              className="min-h-[60px] text-xs leading-relaxed"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOutlineEditing(false)}
                disabled={outlineSaving}
              >
                取消
              </Button>
              <Button size="sm" onClick={saveOutline} disabled={outlineSaving}>
                {outlineSaving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                保存大纲
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 text-muted-foreground">
              <span className="font-medium">大纲：</span>
              {chapter.outline || (
                <span className="italic">（暂无，点击右侧编辑添加）</span>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleSyncOutline}
                disabled={outlineSyncing || generating || !content.trim()}
                title="根据当前正文让 AI 重新生成本章大纲"
              >
                {outlineSyncing ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                从正文同步
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={startOutlineEdit}
              >
                <Pencil className="mr-1 h-3 w-3" />
                编辑大纲
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 备注 */}
      <div className="border-b bg-muted/30 px-6 py-2 text-xs">
        {notesEditing ? (
          <div className="flex flex-col gap-2">
            <Input
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="如：待扩写"
              className="text-xs"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNotesEditing(false)}
                disabled={notesSaving}
              >
                取消
              </Button>
              <Button size="sm" onClick={saveNotes} disabled={notesSaving}>
                {notesSaving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                保存备注
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 text-muted-foreground">
              <span className="font-medium">备注：</span>
              {chapter.notes || (
                <span className="italic">（暂无，点击右侧编辑添加）</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={startNotesEdit}
            >
              <Pencil className="mr-1 h-3 w-3" />
              编辑备注
            </Button>
          </div>
        )}
      </div>

      {/* 涉及角色 */}
      {characters.length > 0 && (
        <div className="border-b bg-muted/30 px-6 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-muted-foreground">涉及角色：</span>
            {characters.map((char) => {
              const on = (chapter.characterIds ?? []).includes(char.id);
              return (
                <button
                  key={char.id}
                  type="button"
                  onClick={() => toggleCharacter(char.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {char.name}
                </button>
              );
            })}
          </div>
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
              {generationIncomplete ? " · 生成未完成" : ""}
              {generationProgress
                ? ` · 正在生成 ${generationProgress.current}/${generationProgress.total}`
                : ""}
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
          {loadState === "loading" ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载正文
            </div>
          ) : loadState === "error" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>正文加载失败，为防止覆盖原文，编辑功能已停用。</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                重新加载
              </Button>
            </div>
          ) : tab === "write" ? (
            <Textarea
              value={visibleContent}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={() => !generating && dirty && handleSave(true)}
              disabled={generating}
              placeholder="在此撰写正文，或点击「AI 生成」让 AI 帮你写…"
              className={cn(
                "h-full min-h-full resize-none rounded-none border-0 font-serif text-base leading-loose focus-visible:ring-0",
                "px-[15%] py-8",
              )}
            />
          ) : (
            <div className="px-[15%] py-8">
              {visibleContent.trim() ? (
                <div className="prose prose-lg max-w-none whitespace-pre-wrap font-serif leading-loose dark:prose-invert">
                  <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                    {visibleContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-muted-foreground">还没有正文内容</p>
              )}
            </div>
          )}
        </div>
      </div>

      {checkOpen && checkReport && (
        <div className="flex h-56 shrink-0 flex-col border-t bg-muted/20">
          <div className="flex items-center justify-between border-b px-4 py-1.5">
            <span className="flex items-center gap-2 text-xs font-medium">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              一致性检查 · {significantFindings.length} 个问题
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void runCheck()}
                disabled={checkRunning}
              >
                {checkRunning ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                重新检查
              </Button>
              <button
                onClick={() => setCheckOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                收起
              </button>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-2 text-xs">
            {(checkReport.findings ?? []).length === 0 &&
            (checkReport.foreshadowResolutions ?? []).length === 0 ? (
              <p className="text-muted-foreground">{checkReport.summary}</p>
            ) : (
              <>
                {(checkReport.findings ?? []).map((f, i) => {
                  const sev = SEVERITY_META[f.severity];
                  const cat = FINDING_CATEGORY_META[f.category];
                  return (
                    <div key={`f-${i}`} className="rounded border bg-background p-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: sev.color }}
                        >
                          {sev.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {cat.label}
                        </span>
                        {f.location && (
                          <span className="text-[11px] text-muted-foreground/70">
                            · {f.location}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 leading-relaxed">{f.message}</p>
                      {f.evidence && (
                        <p className="mt-1 border-l-2 pl-2 italic text-muted-foreground">
                          {f.evidence}
                        </p>
                      )}
                      {f.suggestedAction && (
                        <p className="mt-1 text-muted-foreground">
                          建议：{f.suggestedAction}
                        </p>
                      )}
                    </div>
                  );
                })}
                {(checkReport.foreshadowResolutions ?? []).map((r, i) => (
                  <div
                    key={`r-${i}`}
                    className="flex items-start justify-between gap-2 rounded border bg-background p-2"
                  >
                    <div>
                      <p>
                        <span className="text-[11px] text-muted-foreground">
                          疑似已回收伏笔（{r.confidence}）
                        </span>
                      </p>
                      <p className="mt-0.5 italic text-muted-foreground">
                        {r.reason}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      onClick={() => void markForeshadowResolved(r.plotNoteId)}
                    >
                      标记已回收
                    </Button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
