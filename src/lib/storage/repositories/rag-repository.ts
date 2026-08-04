import "server-only";
import type { RagIndexRecord, RagMeta } from "@/lib/rag/chunk";
import { readJson, writeJson } from "@/lib/storage/file-store";
import { ragIndexPath, ragMetaPath } from "@/lib/storage/paths";

export async function readRagIndexRecords(
  projectId: string,
): Promise<RagIndexRecord[]> {
  const raw = await readJson<unknown>(ragIndexPath(projectId), []);
  return Array.isArray(raw) ? (raw as RagIndexRecord[]) : [];
}

export function readRagMetadata(projectId: string): Promise<RagMeta | null> {
  return readJson<RagMeta | null>(ragMetaPath(projectId), null);
}

export async function writeRagSnapshot(
  projectId: string,
  records: RagIndexRecord[],
  metadata: RagMeta,
): Promise<void> {
  await writeJson(ragIndexPath(projectId), records);
  await writeJson(ragMetaPath(projectId), metadata);
}
