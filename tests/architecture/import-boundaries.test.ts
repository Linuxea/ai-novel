import { ESLint } from "eslint";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

async function restrictedImportsFor(source: string, relativePath: string) {
  const eslint = new ESLint({ cwd: projectRoot });
  const filePath = resolve(projectRoot, relativePath);
  const [result] = await eslint.lintText(source, {
    filePath,
  });

  expect(isAbsolute(filePath)).toBe(true);
  expect(result.fatalErrorCount).toBe(0);
  expect(
    result.messages.filter(
      (message) =>
        message.ruleId !== "no-restricted-imports" &&
        message.ruleId !== "architecture/module-boundaries",
    ),
  ).toEqual([]);

  return result.messages.filter(
    (message) =>
      message.ruleId === "no-restricted-imports" ||
      message.ruleId === "architecture/module-boundaries",
  );
}

describe("模块导入边界", () => {
  it("阻止跨模块导入内部路径", async () => {
    const messages = await restrictedImportsFor(
      'import "@/modules/canon/domain/internal";',
      "src/modules/projects/application/probe.ts",
    );

    expect(messages).toHaveLength(1);
  });

  it("阻止领域层依赖 Next、数据库、AI 与平台实现", async () => {
    const messages = await restrictedImportsFor(
      [
        'import "next/server";',
        'import "drizzle-orm";',
        'import "ai";',
        'import "@/platform/database";',
      ].join("\n"),
      "src/modules/canon/domain/probe.ts",
    );

    expect(messages).toHaveLength(4);
  });

  it("阻止领域层依赖应用、遗留实现和其他业务模块", async () => {
    const messages = await restrictedImportsFor(
      [
        'import "@/app/page";',
        'import "@/lib/storage";',
        'import "@/modules/narrative";',
      ].join("\n"),
      "src/modules/canon/domain/probe.ts",
    );

    expect(messages).toHaveLength(3);
  });

  it("阻止领域层导入 Node 内置模块与模块根入口", async () => {
    const messages = await restrictedImportsFor(
      ['import "node:fs";', 'import "@/modules";'].join("\n"),
      "src/modules/canon/domain/probe.ts",
    );

    expect(messages).toHaveLength(2);
  });

  it("领域层只允许 zod 和 Node 纯类型裸包导入", async () => {
    const messages = await restrictedImportsFor(
      [
        'import "fs";',
        'import "node:path";',
        'import "react";',
        'import "@tanstack/react-query";',
      ].join("\n"),
      "src/modules/canon/domain/probe.ts",
    );

    expect(messages).toHaveLength(4);

    const allowed = await restrictedImportsFor(
      [
        'import type { PathLike } from "node:fs";',
        'import { z } from "zod";',
        "export type Probe = PathLike;",
        "void z.string();",
      ].join("\n"),
      "src/modules/canon/domain/probe.ts",
    );

    expect(allowed).toHaveLength(0);
  });

  it("阻止领域层通过相对路径逃逸", async () => {
    const messages = await restrictedImportsFor(
      [
        'export * from "../../../../lib/storage";',
        'void import("../../../../platform/database");',
        'void import("../../../narrative");',
      ].join("\n"),
      "src/modules/canon/domain/nested/probe.ts",
    );

    expect(messages).toHaveLength(3);
  });

  it("阻止绕过模块和平台公开入口", async () => {
    const messages = await restrictedImportsFor(
      [
        'export * from "../../canon/domain/internal";',
        'void import("@/platform/database/internal");',
      ].join("\n"),
      "src/modules/projects/application/probe.ts",
    );

    expect(messages).toHaveLength(2);
  });

  it("拒绝四种公开入口绕过写法", async () => {
    const messages = await restrictedImportsFor(
      [
        'import "../../canon";',
        'import "@/modules/canon/index.ts";',
        'import "@/modules/projects/domain/internal";',
        'import "@/platform/database/index.ts";',
      ].join("\n"),
      "src/modules/projects/application/probe.ts",
    );

    expect(messages).toHaveLength(4);
  });

  it("允许领域层依赖共享契约和纯验证库", async () => {
    const messages = await restrictedImportsFor(
      [
        'import type { DomainModule } from "@/shared/contracts";',
        'import { z } from "zod";',
        "export type Probe = DomainModule;",
        "void z.string();",
      ].join("\n"),
      "src/modules/canon/domain/probe.ts",
    );

    expect(messages).toHaveLength(0);
  });

  it("允许跨模块仅引用公开入口", async () => {
    const messages = await restrictedImportsFor(
      ['import "@/modules/canon";', 'import "@/platform/database";'].join("\n"),
      "src/modules/projects/application/probe.ts",
    );

    expect(messages).toHaveLength(0);
  });
});
