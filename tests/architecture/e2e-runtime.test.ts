import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createE2eRuntime,
  selectChromeLaunch,
} from "../e2e/runtime";
import {
  cleanupRunPaths,
  restoreTsconfig,
} from "../e2e/run-support.mjs";

describe("E2E 隔离运行时", () => {
  it("创建独立数据与构建目录并可重复清理", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ai-novel-project-"));
    const runtime = createE2eRuntime(projectRoot);

    expect(existsSync(runtime.dataDir)).toBe(false);
    mkdirSync(runtime.dataDir, { recursive: true });
    mkdirSync(runtime.distDirAbsolute, { recursive: true });
    writeFileSync(join(runtime.dataDir, "data.txt"), "isolated");
    writeFileSync(join(runtime.distDirAbsolute, "build.txt"), "isolated");

    expect(runtime.dataDir).not.toContain(projectRoot);
    expect(runtime.distDir).toMatch(/^\.next-e2e\/run-/);
    expect(runtime.webServerEnv.DATABASE_PATH).toBe(
      join(runtime.dataDir, "ai-novel.sqlite"),
    );
    expect(runtime.webServerEnv.PLATFORM_WORKERS_ENABLED).toBe("false");

    runtime.cleanup();
    expect(existsSync(runtime.dataDir)).toBe(false);
    expect(existsSync(runtime.distDirAbsolute)).toBe(false);
    expect(existsSync(join(projectRoot, ".next-e2e"))).toBe(false);
    expect(() => runtime.cleanup()).not.toThrow();

    rmSync(projectRoot, { force: true, recursive: true });
  });

  it("优先环境变量和平台路径并回退到 Chrome channel", () => {
    expect(
      selectChromeLaunch(
        { PLAYWRIGHT_CHROME_PATH: "/custom/chrome" },
        "darwin",
        (candidate) => candidate === "/custom/chrome",
      ),
    ).toEqual({ executablePath: "/custom/chrome" });

    expect(
      selectChromeLaunch({}, "linux", (candidate) =>
        candidate === "/usr/bin/google-chrome"),
    ).toEqual({ executablePath: "/usr/bin/google-chrome" });

    expect(selectChromeLaunch({}, "darwin", () => false)).toEqual({
      channel: "chrome",
    });
  });

  it("复用包装进程提供的隔离目录", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ai-novel-project-"));
    const dataDir = mkdtempSync(join(tmpdir(), "ai-novel-e2e-"));
    const distDirAbsolute = join(
      projectRoot,
      ".next-e2e",
      "run-from-wrapper",
    );
    const runtime = createE2eRuntime(projectRoot, {
      PLAYWRIGHT_E2E_DATA_DIR: dataDir,
      PLAYWRIGHT_E2E_DIST_DIR: distDirAbsolute,
    });

    expect(runtime.dataDir).toBe(dataDir);
    expect(runtime.distDirAbsolute).toBe(distDirAbsolute);

    runtime.cleanup();
    rmSync(projectRoot, { force: true, recursive: true });
  });

  it("移除 Next 写入的独立 distDir 类型路径并恢复原配置", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ai-novel-project-"));
    const tsconfigPath = join(projectRoot, "tsconfig.json");
    const original = '{"include":["src/**/*.ts"],"exclude":["node_modules"]}\n';
    writeFileSync(tsconfigPath, original);
    writeFileSync(
      tsconfigPath,
      `${JSON.stringify(
        {
          include: [
            "src/**/*.ts",
            ".next-e2e/run-test/types/**/*.ts",
            ".next-e2e/run-test/dev/types/**/*.ts",
          ],
          exclude: ["node_modules"],
        },
        null,
        2,
      )}\n`,
    );

    restoreTsconfig(projectRoot, ".next-e2e/run-test", original);

    expect(readFileSync(tsconfigPath, "utf8")).toBe(original);
    rmSync(projectRoot, { force: true, recursive: true });
  });

  it("失败时仅保留本次诊断且不删除并发运行目录", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ai-novel-project-"));
    const dataDir = mkdtempSync(join(tmpdir(), "ai-novel-e2e-"));
    const distDir = join(projectRoot, ".next-e2e", "run-a");
    const siblingDistDir = join(projectRoot, ".next-e2e", "run-b");
    const diagnosticDir = join(projectRoot, ".playwright-e2e", "run-a");
    const siblingDiagnosticDir = join(
      projectRoot,
      ".playwright-e2e",
      "run-b",
    );
    for (const directory of [
      distDir,
      siblingDistDir,
      diagnosticDir,
      siblingDiagnosticDir,
    ]) {
      mkdirSync(directory, { recursive: true });
    }

    await cleanupRunPaths({
      dataDir,
      diagnosticDir,
      distDirAbsolute: distDir,
      success: false,
      attempts: 1,
      delayMs: 0,
    });

    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(distDir)).toBe(false);
    expect(existsSync(diagnosticDir)).toBe(true);
    expect(existsSync(siblingDistDir)).toBe(true);
    expect(existsSync(siblingDiagnosticDir)).toBe(true);

    await cleanupRunPaths({
      dataDir,
      diagnosticDir,
      distDirAbsolute: distDir,
      success: true,
      attempts: 1,
      delayMs: 0,
    });

    expect(existsSync(diagnosticDir)).toBe(false);
    expect(existsSync(siblingDiagnosticDir)).toBe(true);
    rmSync(projectRoot, { force: true, recursive: true });
  });
});
