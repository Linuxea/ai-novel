import { defineConfig, devices } from "@playwright/test";
import {
  createE2eRuntime,
  selectChromeLaunch,
} from "./tests/e2e/runtime";

const baseURL = "http://127.0.0.1:3100";
const projectRoot = process.cwd();
const runtime = createE2eRuntime(projectRoot);
const chromeLaunch = selectChromeLaunch();

process.env.PLAYWRIGHT_E2E_DATA_DIR = runtime.dataDir;
process.env.PLAYWRIGHT_E2E_DIST_DIR = runtime.distDirAbsolute;
if (process.env.PLAYWRIGHT_E2E_WRAPPED !== "1") {
  process.once("exit", runtime.cleanup);
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  outputDir: runtime.outputDir,
  globalTeardown:
    process.env.PLAYWRIGHT_E2E_WRAPPED === "1"
      ? undefined
      : "./tests/e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: runtime.reportDir }],
  ],
  use: {
    baseURL,
    channel: chromeLaunch.channel,
    launchOptions: {
      executablePath: chromeLaunch.executablePath,
      args: [
        "--no-sandbox",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    env: runtime.webServerEnv,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
