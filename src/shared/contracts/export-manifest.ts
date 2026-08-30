import { z } from "zod";

export const NOVEL_EXPORT_FORMAT_VERSION = 1 as const;

const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "SHA-256 校验值必须是 64 位十六进制");

const ExportFilePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) => {
      const segments = value.split("/");
      return (
        !value.startsWith("/") &&
        !/^[a-z]:/i.test(value) &&
        !value.includes("\\") &&
        !value.includes("\0") &&
        segments.every(
          (segment) =>
            segment.length > 0 &&
            segment !== "." &&
            segment !== "..",
        )
      );
    },
    "导出文件路径必须是安全相对路径",
  )
  .refine(
    (value) =>
      !/\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(
        value,
      ),
    "SQLite 数据库文件不能作为导出格式",
  );

const ExportFileSchema = z
  .object({
    bytes: z.number().int().nonnegative().safe(),
    checksum: Sha256Schema,
    path: ExportFilePathSchema,
  })
  .strict();

const ExportChecksumSchema = z
  .object({
    algorithm: z.literal("sha256"),
    value: Sha256Schema,
  })
  .strict();

export const ProjectExportModuleManifestSchema = z
  .object({
    checksum: ExportChecksumSchema,
    files: z.array(ExportFileSchema).min(1),
    module: z.literal("projects"),
    schemaVersion: z.literal(1),
  })
  .strict();

export const NovelExportManifestSchema = z
  .object({
    exportedAt: z.iso.datetime({ offset: true }),
    format: z.literal("mozhang-novel-export"),
    formatVersion: z.literal(NOVEL_EXPORT_FORMAT_VERSION),
    includedModules: z
      .array(ProjectExportModuleManifestSchema)
      .min(1)
      .superRefine((modules, context) => {
        const names = modules.map((item) => item.module);
        if (new Set(names).size !== names.length) {
          context.addIssue({
            code: "custom",
            message: "导出模块不能重复",
          });
        }
      }),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        rootChecksum: Sha256Schema,
      })
      .strict(),
    projectId: z.uuid(),
    projectVersion: z.number().int().positive().safe(),
  })
  .strict();

export type NovelExportManifest = z.infer<
  typeof NovelExportManifestSchema
>;
export type ProjectExportModuleManifest = z.infer<
  typeof ProjectExportModuleManifestSchema
>;
