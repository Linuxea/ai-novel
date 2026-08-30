import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": `${root}src`,
      "server-only": `${root}tests/server-only.ts`,
    },
  },
  test: {
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "regression",
          environment: "node",
          include: ["tests/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "tests/domain/**/*.test.{ts,tsx}",
            "tests/architecture/**/*.test.{ts,tsx}",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: [
            "tests/application/**/*.test.{ts,tsx}",
            "tests/integration/**/*.test.{ts,tsx}",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["tests/component/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup/component.ts"],
        },
      },
    ],
  },
});
