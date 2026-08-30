import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function source(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function routeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return routeSources(path);
      }
      return entry.name.endsWith(".ts")
        ? [readFileSync(path, "utf8")]
        : [];
    },
  );
}

describe("projects 垂直切片边界", () => {
  it("API v1 只依赖模块公开入口且不包含数据库实现", () => {
    const routes = routeSources(
      resolve(projectRoot, "src/app/api/v1/projects"),
    );

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route).not.toMatch(/@\/modules\/projects\//);
      expect(route).not.toMatch(/drizzle|node:sqlite|\bSELECT\b|\bUPDATE\b/);
    }
  });

  it("模块入口不暴露仓储与 ORM schema", () => {
    const entrypoint = source("src/modules/projects/index.ts");

    expect(entrypoint).not.toContain("sqlite-project-repository");
    expect(entrypoint).not.toContain("schema-projects");
  });

  it("新 RSC 和 Client Island 不依赖旧文件 store 或 Zustand", () => {
    const rootPage = source("src/app/page.tsx");
    const studioPage = source("src/app/studio/[projectId]/page.tsx");
    const projectUi = [
      source("src/modules/projects/ui/projects-workbench.tsx"),
      source("src/modules/projects/ui/project-studio.tsx"),
    ].join("\n");

    expect(rootPage).not.toContain("@/lib/storage");
    expect(studioPage).not.toContain("@/lib/storage");
    expect(projectUi).not.toMatch(/zustand|\/projects\/\$\{/);
    expect(projectUi).toContain("/studio/");
  });
});
