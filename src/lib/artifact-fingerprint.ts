import { createHash } from "node:crypto";
import type { Chapter, Project } from "@/lib/types";

function fingerprint(value: unknown): string {
  return createHash("sha1")
    .update(JSON.stringify(value), "utf-8")
    .digest("hex")
    .slice(0, 16);
}

export function buildSummaryInputFingerprint(
  project: Pick<Project, "title" | "genre" | "aiModel">,
  chapter: Pick<
    Chapter,
    | "order"
    | "title"
    | "outline"
    | "contentHash"
    | "contentRevision"
  >,
  promptVersion: number,
): string {
  return fingerprint({
    promptVersion,
    project: {
      title: project.title,
      genre: project.genre,
      aiModel: project.aiModel,
    },
    chapter: {
      order: chapter.order,
      title: chapter.title,
      outline: chapter.outline,
      contentHash: chapter.contentHash,
      contentRevision: chapter.contentRevision,
    },
  });
}
