import {
  existsSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

function removeEmptyDirectory(directory) {
  try {
    rmdirSync(directory);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
      throw error;
    }
  }
}

export async function cleanupRunPaths({
  attempts = 20,
  dataDir,
  delayMs = 50,
  diagnosticDir,
  distDirAbsolute,
  success,
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    rmSync(dataDir, { force: true, recursive: true });
    rmSync(distDirAbsolute, { force: true, recursive: true });
    if (success) {
      rmSync(diagnosticDir, { force: true, recursive: true });
    }
    if (attempt < attempts - 1 && delayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }

  removeEmptyDirectory(dirname(distDirAbsolute));
  if (success) {
    removeEmptyDirectory(dirname(diagnosticDir));
  }
}

export function restoreTsconfig(projectRoot, distDir, originalContent) {
  const tsconfigPath = join(projectRoot, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return;
  }

  const currentContent = readFileSync(tsconfigPath, "utf8");
  if (currentContent === originalContent) {
    return;
  }

  const originalConfig = JSON.parse(originalContent);
  const currentConfig = JSON.parse(currentContent);
  const normalizedDistDir = distDir.replaceAll("\\", "/");
  currentConfig.include = (currentConfig.include ?? []).filter(
    (entry) =>
      typeof entry !== "string" ||
      !entry.replaceAll("\\", "/").startsWith(`${normalizedDistDir}/`),
  );

  if (JSON.stringify(currentConfig) === JSON.stringify(originalConfig)) {
    writeFileSync(tsconfigPath, originalContent);
    return;
  }

  writeFileSync(tsconfigPath, `${JSON.stringify(currentConfig, null, 2)}\n`);
}
