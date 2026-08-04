import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = path.join(
  "/tmp/opencode",
  `ai-novel-migration-test-${process.pid}-${Date.now()}`,
);

type Storage = typeof import("@/lib/storage");
let storage: Storage;

beforeAll(async () => {
  process.env.DATA_DIR = dataDir;
  storage = await import("@/lib/storage");
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("project schema migrations", () => {
  it("persists an unversioned project at the current schema version", async () => {
    const project = await storage.createProject({ title: "旧项目" });
    const projectFile = path.join(storage.projectDir(project.id), "project.json");
    const legacy = JSON.parse(await fs.readFile(projectFile, "utf-8")) as Record<
      string,
      unknown
    >;
    delete legacy.schemaVersion;
    delete legacy.ragMode;
    delete legacy.generateStrategy;
    await fs.writeFile(projectFile, JSON.stringify(legacy, null, 2));

    const migrated = await storage.getProject(project.id);
    const persisted = JSON.parse(
      await fs.readFile(projectFile, "utf-8"),
    ) as Record<string, unknown>;

    expect(migrated?.schemaVersion).toBe(1);
    expect(migrated?.ragMode).toBe("off");
    expect(migrated?.generateStrategy).toBe("auto");
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.ragMode).toBe("off");
    expect(persisted.generateStrategy).toBe("auto");
  });

  it("rejects projects written by a newer schema", async () => {
    const project = await storage.createProject({ title: "未来项目" });
    const projectFile = path.join(storage.projectDir(project.id), "project.json");
    const future = JSON.parse(await fs.readFile(projectFile, "utf-8")) as Record<
      string,
      unknown
    >;
    future.schemaVersion = 2;
    await fs.writeFile(projectFile, JSON.stringify(future, null, 2));

    await expect(storage.getProject(project.id)).rejects.toThrow(
      "高于当前支持版本",
    );
    expect(
      (JSON.parse(await fs.readFile(projectFile, "utf-8")) as Record<
        string,
        unknown
      >).schemaVersion,
    ).toBe(2);
  });
});
