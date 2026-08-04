import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { z } from "zod";

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export function isNotFoundError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function readJson<T>(
  filePath: string,
  fallback: T,
  schema?: z.ZodType<T>,
): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return schema ? schema.parse(parsed) : (parsed as T);
  } catch (error) {
    if (isNotFoundError(error)) return fallback;
    throw error;
  }
}

export async function fsyncDir(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch (error) {
    if (
      isNodeError(error) &&
      ["EINVAL", "ENOTSUP", "EBADF"].includes(error.code ?? "")
    ) {
      return;
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function atomicReplaceRaw(
  filePath: string,
  content: string | Buffer,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${nanoid(6)}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tmp, "wx");
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tmp, filePath);
    await fsyncDir(path.dirname(filePath));
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(tmp).catch((error) => {
      if (!isNotFoundError(error)) throw error;
    });
  }
}

export async function deleteFileRaw(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    await fsyncDir(path.dirname(filePath));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function touchDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) await ensureDir(dir);
}
