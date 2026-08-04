import "server-only";
import { readJson, writeJson } from "@/lib/storage/file-store";
import { checksFilePath } from "@/lib/storage/paths";
import {
  ConsistencyReportSchema,
  type ConsistencyReport,
} from "@/lib/types";

export type ChecksMap = Record<string, ConsistencyReport>;

export async function readChecks(projectId: string): Promise<ChecksMap> {
  const raw = await readJson<unknown>(checksFilePath(projectId), {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const checks: ChecksMap = {};
  for (const [chapterId, value] of Object.entries(raw)) {
    const parsed = ConsistencyReportSchema.safeParse(value);
    if (parsed.success) checks[chapterId] = parsed.data;
  }
  return checks;
}

export function writeChecks(
  projectId: string,
  checks: ChecksMap,
): Promise<void> {
  return writeJson(checksFilePath(projectId), checks);
}
