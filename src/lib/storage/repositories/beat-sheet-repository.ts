import "server-only";
import {
  deleteFile,
  readJson,
  writeJson,
} from "@/lib/storage/file-store";
import { beatSheetFilePath } from "@/lib/storage/paths";
import { BeatSheetCacheSchema, type BeatSheetCache } from "@/lib/types";

export async function readBeatSheetCache(
  projectId: string,
  chapterId: string,
): Promise<BeatSheetCache | null> {
  const raw = await readJson<unknown>(
    beatSheetFilePath(projectId, chapterId),
    null,
  );
  const parsed = BeatSheetCacheSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function writeBeatSheetCache(
  projectId: string,
  chapterId: string,
  cache: BeatSheetCache,
): Promise<void> {
  return writeJson(beatSheetFilePath(projectId, chapterId), cache);
}

export function deleteBeatSheetCache(
  projectId: string,
  chapterId: string,
): Promise<boolean> {
  return deleteFile(beatSheetFilePath(projectId, chapterId));
}
