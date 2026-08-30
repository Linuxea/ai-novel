import { randomUUID } from "node:crypto";
import { existsSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export type ChromeLaunchSelection =
  | { readonly executablePath: string; readonly channel?: never }
  | { readonly executablePath?: never; readonly channel: "chrome" };

export interface E2eRuntime {
  readonly dataDir: string;
  readonly diagnosticDir: string;
  readonly distDir: string;
  readonly distDirAbsolute: string;
  readonly outputDir: string;
  readonly reportDir: string;
  readonly webServerEnv: Readonly<Record<string, string>>;
  cleanup(): void;
}

function chromeCandidates(
  environment: Environment,
  platform: NodeJS.Platform,
): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `${environment.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
  }
  if (platform === "win32") {
    return [
      `${environment.PROGRAMFILES ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
      `${environment["PROGRAMFILES(X86)"] ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
      `${environment.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

export function selectChromeLaunch(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  fileExists: (candidate: string) => boolean = existsSync,
): ChromeLaunchSelection {
  const override = environment.PLAYWRIGHT_CHROME_PATH?.trim();
  if (override) {
    return { executablePath: override };
  }

  const detected = chromeCandidates(environment, platform).find(
    (candidate) => candidate.length > 0 && fileExists(candidate),
  );
  return detected ? { executablePath: detected } : { channel: "chrome" };
}

function isInside(base: string, target: string): boolean {
  const relativePath = relative(base, target);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function removeEmptyDirectory(directory: string): void {
  try {
    rmdirSync(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") {
      throw error;
    }
  }
}

export function cleanupE2ePaths(
  projectRoot: string,
  dataDir: string,
  distDirAbsolute: string,
): void {
  const temporaryDataIsSafe =
    dirname(dataDir) === resolve(tmpdir()) &&
    basename(dataDir).startsWith("ai-novel-e2e-");
  const e2eBuildRoot = resolve(projectRoot, ".next-e2e");
  const distDirIsSafe =
    distDirAbsolute !== e2eBuildRoot &&
    isInside(e2eBuildRoot, distDirAbsolute);

  if (temporaryDataIsSafe) {
    rmSync(dataDir, { force: true, recursive: true });
  }
  if (distDirIsSafe) {
    rmSync(distDirAbsolute, { force: true, recursive: true });
    removeEmptyDirectory(e2eBuildRoot);
  }
}

export function createE2eRuntime(
  projectRoot: string,
  environment: Environment = process.env,
): E2eRuntime {
  const runId = `run-${process.pid}-${randomUUID()}`;
  const dataDir =
    environment.PLAYWRIGHT_E2E_DATA_DIR ??
    join(tmpdir(), `ai-novel-e2e-${randomUUID()}`);
  const generatedDistDir = `.next-e2e/${runId}`;
  const distDirAbsolute =
    environment.PLAYWRIGHT_E2E_DIST_DIR ??
    resolve(projectRoot, generatedDistDir);
  const distDir = relative(projectRoot, distDirAbsolute).split(sep).join("/");
  const diagnosticDir =
    environment.PLAYWRIGHT_E2E_DIAGNOSTIC_DIR ??
    resolve(projectRoot, ".playwright-e2e", runId);
  const outputDir =
    environment.PLAYWRIGHT_E2E_OUTPUT_DIR ??
    resolve(diagnosticDir, "test-results");
  const reportDir =
    environment.PLAYWRIGHT_E2E_REPORT_DIR ??
    resolve(diagnosticDir, "report");
  let cleaned = false;

  return {
    dataDir,
    diagnosticDir,
    distDir,
    distDirAbsolute,
    outputDir,
    reportDir,
    webServerEnv: {
      AI_API_KEY: "",
      AI_BASE_URL: "",
      AI_MODEL: "",
      DATA_DIR: dataDir,
      DATABASE_PATH: join(dataDir, "ai-novel.sqlite"),
      EMBED_API_KEY: "",
      EMBED_BASE_URL: "",
      EMBED_MODEL: "",
      NEXT_DIST_DIR: distDir,
      PLATFORM_WORKERS_ENABLED: "false",
    },
    cleanup() {
      if (cleaned) {
        return;
      }
      cleaned = true;
      cleanupE2ePaths(projectRoot, dataDir, distDirAbsolute);
    },
  };
}
