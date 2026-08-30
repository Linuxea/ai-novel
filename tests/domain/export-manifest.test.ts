import { describe, expect, it } from "vitest";
import {
  NOVEL_EXPORT_FORMAT_VERSION,
  NovelExportManifestSchema,
} from "@/shared/contracts";

const CHECKSUM = "a".repeat(64);

function manifestWithPath(path: string) {
  return {
    exportedAt: "2026-08-31T08:00:00.000Z",
    format: "mozhang-novel-export",
    formatVersion: NOVEL_EXPORT_FORMAT_VERSION,
    includedModules: [
      {
        checksum: { algorithm: "sha256", value: CHECKSUM },
        files: [{ bytes: 10, checksum: CHECKSUM, path }],
        module: "projects",
        schemaVersion: 1,
      },
    ],
    integrity: {
      algorithm: "sha256",
      rootChecksum: CHECKSUM,
    },
    projectId: "018f47a2-9000-7f11-8d24-4a1cc5e6d740",
    projectVersion: 4,
  };
}

describe("版本化小说导出 manifest", () => {
  it("当前格式只注册 projects 模块并携带作品版本与校验信息", () => {
    const manifest = NovelExportManifestSchema.parse({
      exportedAt: "2026-08-31T08:00:00.000Z",
      format: "mozhang-novel-export",
      formatVersion: NOVEL_EXPORT_FORMAT_VERSION,
      includedModules: [
        {
          checksum: {
            algorithm: "sha256",
            value: CHECKSUM,
          },
          files: [
            {
              bytes: 1_024,
              checksum: CHECKSUM,
              path: "projects/project.json",
            },
          ],
          module: "projects",
          schemaVersion: 1,
        },
      ],
      integrity: {
        algorithm: "sha256",
        rootChecksum: CHECKSUM,
      },
      projectId: "018f47a2-9000-7f11-8d24-4a1cc5e6d740",
      projectVersion: 4,
    });

    expect(manifest.formatVersion).toBe(1);
    expect(manifest.includedModules.map((item) => item.module)).toEqual([
      "projects",
    ]);
  });

  it("拒绝未注册模块、重复模块与 SQLite 数据库文件", () => {
    const base = {
      exportedAt: "2026-08-31T08:00:00.000Z",
      format: "mozhang-novel-export",
      formatVersion: 1,
      integrity: {
        algorithm: "sha256",
        rootChecksum: CHECKSUM,
      },
      projectId: "018f47a2-9000-7f11-8d24-4a1cc5e6d740",
      projectVersion: 4,
    };
    const projectModule = {
      checksum: { algorithm: "sha256", value: CHECKSUM },
      files: [
        {
          bytes: 10,
          checksum: CHECKSUM,
          path: "projects/project.json",
        },
      ],
      module: "projects",
      schemaVersion: 1,
    };

    expect(
      NovelExportManifestSchema.safeParse({
        ...base,
        includedModules: [{ ...projectModule, module: "canon" }],
      }).success,
    ).toBe(false);
    expect(
      NovelExportManifestSchema.safeParse({
        ...base,
        includedModules: [projectModule, projectModule],
      }).success,
    ).toBe(false);
    expect(
      NovelExportManifestSchema.safeParse({
        ...base,
        includedModules: [
          {
            ...projectModule,
            files: [
              {
                bytes: 10,
                checksum: CHECKSUM,
                path: "ai-novel.sqlite",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    "",
    "/projects/project.json",
    "//server/share/project.json",
    "\\\\server\\share\\project.json",
    "C:/projects/project.json",
    "c:projects/project.json",
    "projects\\project.json",
    "projects//project.json",
    "projects/./project.json",
    "projects/../project.json",
    "projects/project.json/",
    "projects/\0project.json",
  ])("拒绝非 POSIX 安全相对路径：%j", (path) => {
    expect(
      NovelExportManifestSchema.safeParse(
        manifestWithPath(path),
      ).success,
    ).toBe(false);
  });

  it.each([
    "data.db",
    "data.DB",
    "nested/data.sqlite",
    "nested/data.SQLITE3",
    "data.db-wal",
    "data.DB-SHM",
    "nested/data.sqlite-journal",
    "nested/data.SQLITE3-WAL",
  ])("拒绝 SQLite 数据库及 sidecar：%s", (path) => {
    expect(
      NovelExportManifestSchema.safeParse(
        manifestWithPath(path),
      ).success,
    ).toBe(false);
  });

  it.each([
    "projects/project.json",
    "projects/chapters/chapter-1.md",
    "assets/data.db.json",
    "notes/sqlite-guide.txt",
  ])("接受规范化 POSIX 相对路径：%s", (path) => {
    expect(
      NovelExportManifestSchema.safeParse(
        manifestWithPath(path),
      ).success,
    ).toBe(true);
  });
});
