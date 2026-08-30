import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  cleanupRunPaths,
  restoreTsconfig,
} from "./run-support.mjs";

const projectRoot = process.cwd();
const runId = `run-${process.pid}-${randomUUID()}`;
const dataDir = mkdtempSync(join(tmpdir(), "ai-novel-e2e-"));
const distDir = `.next-e2e/${runId}`;
const distDirAbsolute = resolve(projectRoot, distDir);
const diagnosticDir = resolve(projectRoot, ".playwright-e2e", runId);
const outputDir = resolve(diagnosticDir, "test-results");
const reportDir = resolve(diagnosticDir, "report");
const originalTsconfig = readFileSync(
  resolve(projectRoot, "tsconfig.json"),
  "utf8",
);
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

function runPlaywright() {
  return new Promise((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", ...process.argv.slice(2)],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          AI_API_KEY: "",
          AI_BASE_URL: "",
          AI_MODEL: "",
          DATA_DIR: dataDir,
          DATABASE_PATH: join(dataDir, "ai-novel.sqlite"),
          EMBED_API_KEY: "",
          EMBED_BASE_URL: "",
          EMBED_MODEL: "",
          NEXT_DIST_DIR: distDir,
          PLAYWRIGHT_E2E_DATA_DIR: dataDir,
          PLAYWRIGHT_E2E_DIAGNOSTIC_DIR: diagnosticDir,
          PLAYWRIGHT_E2E_DIST_DIR: distDirAbsolute,
          PLAYWRIGHT_E2E_OUTPUT_DIR: outputDir,
          PLAYWRIGHT_E2E_REPORT_DIR: reportDir,
          PLAYWRIGHT_E2E_WRAPPED: "1",
          PLATFORM_WORKERS_ENABLED: "false",
        },
        stdio: "inherit",
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveExit(signal ? 1 : (code ?? 1));
    });
  });
}

let exitCode = 1;
try {
  exitCode = await runPlaywright();
} finally {
  restoreTsconfig(projectRoot, distDir, originalTsconfig);
  await cleanupRunPaths({
    dataDir,
    diagnosticDir,
    distDirAbsolute,
    success: exitCode === 0,
  });
  if (exitCode !== 0) {
    console.error(`E2E 诊断已保留：${diagnosticDir}`);
  }
}

process.exitCode = exitCode;
