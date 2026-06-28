"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, Check, Loader2, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { cn } from "@/lib/utils";

const REMARK_PLUGINS = [remarkGfm];

const TOOL_LABELS: Record<string, string> = {
  "tool-upsert_character": "创建/更新角色",
  "tool-delete_character": "删除角色",
  "tool-upsert_relationship": "设定关系",
  "tool-upsert_world_section": "记录世界观",
  "tool-create_chapter_outline": "创建章节",
  "tool-list_relationship_types": "查询关系类型",
};

export const MessageItem = React.memo(function MessageItem({
  message,
}: {
  message: UIMessage;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
        )}
      >
        {isUser ? "我" : "墨"}
      </div>
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-2",
          isUser && "items-end",
        )}
      >
        {message.parts.map((part, i) => {
          const key = `${message.id}-${i}`;

          if (part.type === "reasoning") {
            const text = part.text?.trim();
            if (!text) return null;
            return (
              <ReasoningDetails
                key={key}
                text={text}
                streaming={part.state === "streaming"}
              />
            );
          }

          if (part.type === "text" && part.text.trim()) {
            return (
              <div
                key={key}
                className={cn(
                  "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  isUser
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                {isUser ? (
                  <span className="whitespace-pre-wrap">{part.text}</span>
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                      {part.text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            );
          }

          if (part.type.startsWith("tool-")) {
            const toolPart = part as {
              type: string;
              state: string;
              input?: Record<string, unknown>;
              output?: { message?: string; name?: string };
            };
            const label = TOOL_LABELS[part.type] ?? part.type.replace("tool-", "");
            const detail =
              toolPart.output?.message ||
              toolPart.output?.name ||
              (toolPart.input?.name as string) ||
              "";
            const done = toolPart.state === "output-available";
            return (
              <div
                key={key}
                className="flex items-center gap-1.5 self-start rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground"
              >
                {done ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                <Wrench className="h-3 w-3" />
                <span>
                  {label}
                  {detail ? ` · ${detail}` : ""}
                </span>
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
});

function ReasoningDetails({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="self-start rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium select-none">
        {streaming ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Brain className="h-3 w-3" />
        )}
        思考过程
      </summary>
      <div className="mt-2 whitespace-pre-wrap leading-relaxed">{text}</div>
    </details>
  );
}
