import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import {
  atomicReplaceRaw,
  deleteFileRaw,
  ensureDir,
  fileExists,
  fsyncDir,
  isNotFoundError,
  readJson,
  touchDir,
} from "@/lib/storage/raw-file";
import { captureBeforeMutation } from "@/lib/storage/transaction";

export { ensureDir, fileExists, readJson, touchDir };

export async function writeFile(
  filePath: string,
  content: string | Buffer,
): Promise<void> {
  await captureBeforeMutation(filePath);
  await atomicReplaceRaw(filePath, content);
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function writeText(
  filePath: string,
  content: string,
): Promise<void> {
  await writeFile(filePath, content);
}

export async function deleteFile(filePath: string): Promise<boolean> {
  await captureBeforeMutation(filePath);
  return deleteFileRaw(filePath);
}

async function captureDirectoryFiles(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await captureDirectoryFiles(entryPath);
    } else if (entry.isFile()) {
      await captureBeforeMutation(entryPath);
    }
  }
}

export async function deleteDirectory(dir: string): Promise<boolean> {
  try {
    await captureDirectoryFiles(dir);
    await fs.rm(dir, { recursive: true, force: true });
    await fsyncDir(path.dirname(dir));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function readValidatedJson<T>(
  filePath: string,
  fallback: T,
  schema: z.ZodType<T>,
): Promise<T> {
  return readJson(filePath, fallback, schema);
}
