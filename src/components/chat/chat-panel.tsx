"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Square, Sparkles, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageItem } from "@/components/chat/message-item";
import { api } from "@/lib/api";
import { useProjectStore } from "@/lib/store";

const SUGGESTIONS = [
  "帮我构思一个故事的开头",
  "我们来设计主角的人物设定",
  "帮我建立这个世界的基本规则",
  "梳理一下目前角色的关系",
];

export function ChatPanel({ projectId }: { projectId: string }) {
  const [input, setInput] = useState("");
  const reloadStore = useProjectStore((s) => s.reload);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const initRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const messagesRef = useRef<unknown[]>([]);
  const saveImplRef = useRef<() => void>(() => {});

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { projectId },
      }),
    [projectId],
  );

  const { messages, sendMessage, status, stop, setMessages, error } =
    useChat({ transport });

  const busy = status === "streaming" || status === "submitted";

  // 首次加载历史对话
  useEffect(() => {
    let cancelled = false;
    api
      .getChat(projectId)
      .then((res) => {
        if (!cancelled && Array.isArray(res.messages) && res.messages.length > 0) {
          setMessages(res.messages as never[]);
        }
      })
      .catch(() => {
        /* 项目无历史或路由未就绪时静默处理 */
      })
      .finally(() => {
        initRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, setMessages]);

  // 保持 messagesRef 为最新（供保存时快照，须在保存触发前同步）
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 当回复完成（status -> ready）时持久化并刷新资料库
  const doSave = useCallback(() => {
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    const snapshot = messagesRef.current;
    Promise.all([
      api.saveChat(projectId, snapshot as unknown[]),
      reloadStore(),
    ])
      .catch(() => {})
      .finally(() => {
        savingRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          // 经 ref 调用最新的 doSave，避免自引用
          saveImplRef.current();
        }
      });
  }, [projectId, reloadStore]);

  // 让递归重试始终调用最新的 doSave
  useEffect(() => {
    saveImplRef.current = doSave;
  }, [doSave]);

  useEffect(() => {
    if (status === "ready" && initRef.current && messages.length > 0) {
      doSave();
    }
  }, [status, messages.length, messages, doSave]);

  // 错误提示
  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  // 自动滚动到底部（仅在用户已贴底时跟随，避免打断向上翻看）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function handleSubmit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendMessage({ text });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleClear() {
    if (!confirm("清空所有对话历史？")) return;
    await api.clearChat(projectId);
    setMessages([]);
    toast.success("已清空对话");
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h1 className="font-semibold">AI 对话</h1>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <Eraser className="mr-2 h-3.5 w-3.5" />
            清空
          </Button>
        )}
      </header>

      {/* 消息区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300">
                <Sparkles className="h-7 w-7" />
              </div>
              <div>
                <p className="text-lg font-semibold">开始构建你的故事</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  与 AI 探讨世界观、人物、剧情，AI 会自动记录到资料库
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-full border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => <MessageItem key={m.id} message={m} />)
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t bg-background p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息与 AI 交流…（Enter 发送，Shift+Enter 换行）"
            rows={1}
            className="max-h-40 min-h-[44px] resize-none"
          />
          {busy ? (
            <Button onClick={stop} size="icon" variant="outline" className="h-11 w-11">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              size="icon"
              className="h-11 w-11"
              disabled={!input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
