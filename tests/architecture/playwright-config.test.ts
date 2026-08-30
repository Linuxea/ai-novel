import { isAbsolute, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../../playwright.config";

const chromeArguments = [
  "--no-sandbox",
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

describe("Playwright E2E 配置", () => {
  it("使用系统 Chrome 和工作区规定的启动参数", () => {
    const executablePath =
      playwrightConfig.use?.launchOptions?.executablePath;
    expect(
      executablePath ? isAbsolute(executablePath) : playwrightConfig.use?.channel,
    ).toBeTruthy();
    expect(playwrightConfig.use?.launchOptions?.args).toEqual(
      expect.arrayContaining(chromeArguments),
    );
  });

  it("在独立端口自行管理测试服务", () => {
    expect(playwrightConfig.webServer).toMatchObject({
      command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
      env: {
        AI_API_KEY: "",
        EMBED_API_KEY: "",
        DATA_DIR: expect.stringContaining("ai-novel-e2e-"),
        DATABASE_PATH: expect.stringMatching(
          /ai-novel-e2e-.+\/ai-novel\.sqlite$/,
        ),
        NEXT_DIST_DIR: expect.stringMatching(/^\.next-e2e\/run-/),
        PLATFORM_WORKERS_ENABLED: "false",
      },
      reuseExistingServer: false,
      url: "http://127.0.0.1:3100",
    });
    expect(playwrightConfig.globalTeardown).toBe(
      "./tests/e2e/global-teardown.ts",
    );
    expect(playwrightConfig.timeout).toBeGreaterThanOrEqual(120_000);
  });

  it("将失败诊断写入本次运行的独立目录", () => {
    const outputDir = playwrightConfig.outputDir ?? "";
    const outputSegments = relative(process.cwd(), outputDir).split(sep);

    expect(outputSegments[0]).toBe(".playwright-e2e");
    expect(outputSegments[1]).toMatch(/^run-/);
    expect(playwrightConfig.use?.trace).toBe("retain-on-failure");
    expect(playwrightConfig.reporter).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          "html",
          expect.objectContaining({
            open: "never",
            outputFolder: expect.stringContaining(".playwright-e2e"),
          }),
        ]),
      ]),
    );
  });
});
