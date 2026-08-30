import {
  existsSync,
  lstatSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

export interface ProtectedPathOptions {
  readonly allowMemory?: boolean;
  readonly cwd?: string;
  readonly label?: string;
}

function isPathInside(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return (
    child === "" ||
    (child !== ".." &&
      !child.startsWith(`..${sep}`) &&
      !isAbsolute(child))
  );
}

function assertNoSymlinkComponents(filePath: string): void {
  const root = parse(filePath).root;
  const segments = relative(root, filePath)
    .split(sep)
    .filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const metadata = lstatSync(
        /*turbopackIgnore: true*/ current,
      );
      if (metadata.isSymbolicLink()) {
        readlinkSync(/*turbopackIgnore: true*/ current);
        throw new Error(`路径组件不得为符号链接: ${current}`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
}

function canonicalizeProspectivePath(filePath: string): string {
  const missingSegments: string[] = [];
  let existingAncestor = filePath;

  while (
    !existsSync(
      /*turbopackIgnore: true*/ existingAncestor,
    )
  ) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      break;
    }
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }

  const canonicalAncestor = realpathSync.native(
    /*turbopackIgnore: true*/ existingAncestor,
  );
  return resolve(canonicalAncestor, ...missingSegments);
}

function resolveFromCwd(pathname: string, cwd: string): string {
  return resolve(
    /*turbopackIgnore: true*/ cwd,
    pathname,
  );
}

export function resolvePathOutsideLegacyProjects(
  pathname: string,
  options: ProtectedPathOptions = {},
): string {
  const normalized = pathname.trim();
  if (!normalized) {
    throw new Error(`${options.label ?? "路径"}不能为空`);
  }
  if (normalized === ":memory:" && options.allowMemory) {
    return normalized;
  }

  const cwd = resolve(
    /*turbopackIgnore: true*/ options.cwd ?? process.cwd(),
  );
  const resolvedPath = resolveFromCwd(normalized, cwd);
  const legacyPath = resolveFromCwd("data/projects", cwd);
  assertNoSymlinkComponents(resolvedPath);
  const canonicalPath = canonicalizeProspectivePath(resolvedPath);
  const canonicalLegacyPath =
    canonicalizeProspectivePath(legacyPath);

  if (
    isPathInside(legacyPath, resolvedPath) ||
    isPathInside(canonicalLegacyPath, canonicalPath)
  ) {
    throw new Error(
      `${options.label ?? "路径"}不得位于旧 data/projects 树`,
    );
  }
  return resolvedPath;
}

export function pathsReferToSameLocation(
  firstPath: string,
  secondPath: string,
  options: Pick<ProtectedPathOptions, "cwd"> = {},
): boolean {
  const cwd = resolve(
    /*turbopackIgnore: true*/ options.cwd ?? process.cwd(),
  );
  const resolvedFirstPath = resolveFromCwd(firstPath, cwd);
  const resolvedSecondPath = resolveFromCwd(secondPath, cwd);
  assertNoSymlinkComponents(resolvedFirstPath);
  assertNoSymlinkComponents(resolvedSecondPath);
  return (
    canonicalizeProspectivePath(resolvedFirstPath) ===
    canonicalizeProspectivePath(resolvedSecondPath)
  );
}
