import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import packageJson from "../../package.json";
import tailwindConfig from "../../tailwind.config";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("项目运行配置", () => {
  it("声明 node:sqlite 所需 Node 下限并精确固定 Drizzle RC", () => {
    expect(packageJson.engines.node).toBe(
      "^22.22.2 || ^24.15.0 || >=26.0.0",
    );
    expect(packageJson.dependencies["drizzle-orm"]).toBe("1.0.0-rc.4");
    expect(packageJson.devDependencies["drizzle-kit"]).toBe("1.0.0-rc.4");
    expect(packageJson.scripts["test:e2e"]).toBe("node tests/e2e/run.mjs");
  });

  it("Next 使用 E2E 指定的独立 distDir", async () => {
    vi.stubEnv("NEXT_DIST_DIR", ".next-e2e/config-test");

    const { default: nextConfig } = await import("../../next.config");

    expect(nextConfig.distDir).toBe(".next-e2e/config-test");
  });

  it("生产 Tailwind 扫描模块 UI 并生成其响应式与阴影样式", async () => {
    expect(tailwindConfig.content).toContain(
      "./src/modules/**/*.{ts,tsx}",
    );

    const result = await postcss([
      tailwindcss(tailwindConfig),
    ]).process("@tailwind utilities;", {
      from: resolve(projectRoot, "src/app/globals.css"),
    });

    expect(result.css).toContain(
      ".shadow-\\[4px_4px_0_\\#ded3c2\\]",
    );
    expect(result.css).toContain(
      ".lg\\:grid-cols-\\[1fr_22rem\\]",
    );
    expect(result.css).toContain("@media (min-width: 1024px)");
  });

  it("生产文件追踪为 instrumentation 和服务端路由包含全部迁移资产", async () => {
    const { default: nextConfig } = await import("../../next.config");

    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/*": ["./drizzle/**/*"],
      instrumentation: ["./drizzle/**/*"],
    });
    expect(packageJson.scripts.build).toContain(
      "scripts/verify-migration-trace.mjs",
    );
    expect(packageJson.scripts.build).toContain(
      "scripts/augment-instrumentation-trace.mjs",
    );
    const verifier = readFileSync(
      resolve(projectRoot, "scripts/verify-migration-trace.mjs"),
      "utf8",
    );
    const instrumentation = readFileSync(
      resolve(projectRoot, "src/instrumentation.ts"),
      "utf8",
    );
    expect(verifier).toContain(
      "server/instrumentation.js.nft.json",
    );
    expect(verifier).not.toContain(
      'filePath.endsWith(".nft.json")',
    );
    const traceAugmenter = readFileSync(
      resolve(
        projectRoot,
        "scripts/augment-instrumentation-trace.mjs",
      ),
      "utf8",
    );
    expect(traceAugmenter).toContain(
      "20260830160941_platform_core/migration.sql",
    );
    expect(traceAugmenter).toContain(
      "20260830160941_platform_core/snapshot.json",
    );
    expect(traceAugmenter).toContain(
      "20260830173214_acoustic_doctor_faustus/migration.sql",
    );
    expect(traceAugmenter).toContain(
      "20260830173214_acoustic_doctor_faustus/snapshot.json",
    );
    expect(traceAugmenter).toContain(
      "20260830182342_same_speedball/migration.sql",
    );
    expect(traceAugmenter).toContain(
      "20260830182342_same_speedball/snapshot.json",
    );
    expect(instrumentation).not.toContain('from "node:fs"');
  });

  it("忽略浏览器测试产物和独立构建目录", () => {
    const gitignore = readFileSync(resolve(projectRoot, ".gitignore"), "utf8");
    const eslintConfig = readFileSync(
      resolve(projectRoot, "eslint.config.mjs"),
      "utf8",
    );

    expect(gitignore).toContain("/test-results/");
    expect(gitignore).toContain("/playwright-report/");
    expect(gitignore).toContain("/.next-e2e/");
    expect(gitignore).toContain("/.playwright-e2e/");
    expect(eslintConfig).toContain('".next-e2e/**"');
    expect(eslintConfig).toContain('".playwright-e2e/**"');
  });

  it("README 列出全部分层测试脚本", () => {
    const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8");

    for (const script of [
      "npm test",
      "npm run test:unit",
      "npm run test:integration",
      "npm run test:component",
      "npm run test:e2e",
    ]) {
      expect(readme).toContain(script);
    }
  });

  it("Drizzle 配置生成真实 SQLite 迁移目录", async () => {
    vi.stubEnv("DATABASE_PATH", "/tmp/ai-novel-config.sqlite");

    const { default: drizzleConfig } = await import(
      "../../drizzle.config"
    );

    expect(drizzleConfig).toMatchObject({
      dbCredentials: { url: "/tmp/ai-novel-config.sqlite" },
      dialect: "sqlite",
      out: "./drizzle",
      schema: "./src/platform/database/schema.ts",
    });
  });

  it("声明数据库维护脚本与平台环境变量", () => {
    for (const script of [
      "db:generate",
      "db:migrate",
      "db:check",
      "db:backup",
      "db:restore",
    ] as const) {
      expect(packageJson.scripts[script]).toBeTruthy();
    }

    const envExample = readFileSync(
      resolve(projectRoot, ".env.example"),
      "utf8",
    );
    for (const variable of [
      "DATABASE_PATH=data/ai-novel.sqlite",
      "PLATFORM_WORKERS_ENABLED=true",
      "PLATFORM_WORKER_INTERVAL_MS=1000",
    ]) {
      expect(envExample).toContain(variable);
    }
  });

  it("文档区分 SQLite 平台库与旧文件存储", () => {
    const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8");
    const agents = readFileSync(resolve(projectRoot, "AGENTS.md"), "utf8");
    const architecture = readFileSync(
      resolve(projectRoot, "docs/architecture/README.md"),
      "utf8",
    );

    for (const document of [readme, agents]) {
      expect(document).toContain("data/ai-novel.sqlite");
      expect(document).toContain("data/projects");
      expect(document).toContain("npm run db:backup");
      expect(document).toContain("npm run db:restore");
    }
    expect(architecture).toContain("database-jobs-observability.md");
  });
});
