import "server-only";
import path from "node:path";
import { env } from "@/env";

export function dataRootDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.DATA_DIR);
}

export function assertSafeId(id: string): void {
  if (!id || !/^[\w-]+$/.test(id)) {
    throw new Error(`非法 ID: ${JSON.stringify(id)}`);
  }
}

export function projectsDir(): string {
  return path.join(/*turbopackIgnore: true*/ dataRootDir(), "projects");
}

export function projectDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(/*turbopackIgnore: true*/ projectsDir(), projectId);
}

export function chaptersDir(projectId: string): string {
  return path.join(/*turbopackIgnore: true*/ projectDir(projectId), "chapters");
}

export function chapterFilePath(projectId: string, chapterId: string): string {
  assertSafeId(chapterId);
  return path.join(chaptersDir(projectId), `${chapterId}.md`);
}

export function beatSheetFilePath(
  projectId: string,
  chapterId: string,
): string {
  assertSafeId(chapterId);
  return path.join(chaptersDir(projectId), `${chapterId}.beats.json`);
}

export function checksFilePath(projectId: string): string {
  return path.join(projectDir(projectId), "checks.json");
}

export function ragDir(projectId: string): string {
  return path.join(/*turbopackIgnore: true*/ projectDir(projectId), "rag");
}

export function ragIndexPath(projectId: string): string {
  return path.join(/*turbopackIgnore: true*/ ragDir(projectId), "index.json");
}

export function ragMetaPath(projectId: string): string {
  return path.join(/*turbopackIgnore: true*/ ragDir(projectId), "meta.json");
}

export function transactionsDir(): string {
  return path.join(/*turbopackIgnore: true*/ dataRootDir(), ".transactions");
}

export function projectTransactionsDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(transactionsDir(), projectId);
}
