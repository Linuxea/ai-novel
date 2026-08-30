import { readdirSync, readFileSync } from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceRoot = resolve(projectRoot, "src");
const sourceExtensions = /\.[cm]?[jt]sx?$/;
const moduleNames = new Set([
  "projects",
  "canon",
  "narrative",
  "manuscript",
  "changes",
  "intelligence",
]);
const platformNames = new Set([
  "database",
  "events",
  "jobs",
  "ai",
  "observability",
]);

interface BoundaryViolation {
  readonly importer: string;
  readonly reason: string;
  readonly specifier: string;
}

interface SourceAnalysis {
  readonly diagnostics: readonly string[];
  readonly violations: readonly BoundaryViolation[];
}

function analyzeSourceImports(
  source: string,
  importer: string,
): SourceAnalysis {
  const diagnostics = (
    ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
      },
      fileName: importer,
      reportDiagnostics: true,
    }).diagnostics ?? []
  )
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  const sourceFile = ts.createSourceFile(
    importer,
    source,
    ts.ScriptTarget.ESNext,
    true,
    importer.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: BoundaryViolation[] = [];

  function inspectSpecifier(
    specifier: string | undefined,
    isTypeOnly = false,
  ) {
    const reason = boundaryViolationReason(importer, specifier, isTypeOnly);
    if (reason) {
      violations.push({
        importer,
        reason,
        specifier: specifier ?? "<dynamic>",
      });
    }
  }

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      inspectSpecifier(
        node.moduleSpecifier.text,
        ts.isExportDeclaration(node)
          ? node.isTypeOnly
          : Boolean(node.importClause?.isTypeOnly),
      );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      inspectSpecifier(
        node.moduleReference.expression.text,
        node.isTypeOnly,
      );
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      inspectSpecifier(
        argument && ts.isStringLiteralLike(argument) ? argument.text : undefined,
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { diagnostics, violations };
}

function analyzeProjectSources(root: string): SourceAnalysis {
  const diagnostics: string[] = [];
  const violations: BoundaryViolation[] = [];
  const pending = [resolve(root, "src")];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      continue;
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile() && sourceExtensions.test(entry.name)) {
        const analysis = analyzeSourceImports(
          readFileSync(absolutePath, "utf8"),
          absolutePath,
        );
        diagnostics.push(
          ...analysis.diagnostics.map(
            (diagnostic) => `${absolutePath}: ${diagnostic}`,
          ),
        );
        violations.push(...analysis.violations);
      }
    }
  }

  return { diagnostics, violations };
}

function pathSegments(base: string, target: string): string[] | undefined {
  const relativePath = relative(base, target);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return undefined;
  }
  return relativePath ? relativePath.split(sep) : [];
}

function isInside(base: string, target: string): boolean {
  return pathSegments(base, target) !== undefined;
}

function localTarget(importer: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) {
    return resolve(sourceRoot, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return resolve(dirname(importer), specifier);
  }
  return undefined;
}

function boundaryViolationReason(
  importer: string,
  specifier: string | undefined,
  isTypeOnly = false,
): string | undefined {
  const importerSegments = pathSegments(sourceRoot, importer);
  if (!importerSegments) {
    return undefined;
  }
  const governed =
    importerSegments[0] === "modules" ||
    importerSegments[0] === "platform" ||
    (importerSegments[0] === "shared" && importerSegments[1] === "contracts");

  if (specifier === undefined) {
    return governed ? "动态导入必须使用字符串字面量" : undefined;
  }

  const inDomain =
    importerSegments[0] === "modules" && importerSegments[2] === "domain";

  const target = localTarget(importer, specifier);
  if (!target) {
    if (inDomain) {
      if (specifier === "zod") {
        return undefined;
      }
      if (isTypeOnly && specifier.startsWith("node:")) {
        return undefined;
      }
      return "领域层裸包仅允许 zod 与 Node 纯类型导入";
    }
    return undefined;
  }

  if (inDomain) {
    const ownDomain = resolve(
      sourceRoot,
      "modules",
      importerSegments[1] ?? "",
      "domain",
    );
    if (specifier === "@/shared/contracts") {
      return undefined;
    }
    if (!specifier.startsWith(".") || !isInside(ownDomain, target)) {
      return "领域层只能相对导入本模块 domain 或使用共享契约公开入口";
    }
    return undefined;
  }

  const sharedContracts = resolve(sourceRoot, "shared", "contracts");
  if (
    isInside(sharedContracts, importer) &&
    !isInside(sharedContracts, target)
  ) {
    return "共享契约不得依赖外部实现";
  }

  const targetSegments = pathSegments(sourceRoot, target);
  if (!targetSegments) {
    return governed ? "受控源码不得通过相对路径逃逸 src" : undefined;
  }

  if (targetSegments[0] === "modules" && targetSegments.length === 1) {
    return "模块根入口不能替代具体模块公开入口";
  }

  if (targetSegments[0] === "modules" && targetSegments.length > 1) {
    const targetModule = targetSegments[1];
    if (moduleNames.has(targetModule)) {
      const sameModule =
        importerSegments[0] === "modules" &&
        importerSegments[1] === targetModule;
      if (sameModule && specifier.startsWith("@/modules/")) {
        return "同模块内部只能使用相对导入";
      }
      if (
        !sameModule &&
        specifier !== `@/modules/${targetModule}`
      ) {
        return "跨模块只能使用精确公开别名";
      }
    } else if (
      targetModule !== "index.ts" &&
      importerSegments[0] !== "modules"
    ) {
      return "模块根内部文件不得从模块外部导入";
    }
  }

  if (targetSegments[0] === "platform" && targetSegments.length === 1) {
    return "平台根入口不能替代具体能力公开入口";
  }

  if (targetSegments[0] === "platform" && targetSegments.length > 1) {
    const targetCapability = targetSegments[1];
    if (platformNames.has(targetCapability)) {
      const sameCapability =
        importerSegments[0] === "platform" &&
        importerSegments[1] === targetCapability;
      if (sameCapability && specifier.startsWith("@/platform/")) {
        return "同一平台能力内部只能使用相对导入";
      }
      if (
        !sameCapability &&
        specifier !== `@/platform/${targetCapability}`
      ) {
        return "跨平台能力只能使用精确公开别名";
      }
    } else if (
      targetCapability !== "index.ts" &&
      importerSegments[0] !== "platform"
    ) {
      return "平台内部文件不得从平台外部导入";
    }
  }

  return undefined;
}

describe("绝对路径架构扫描", () => {
  it("识别 import、export 和动态 import 的相对路径逃逸", () => {
    const importer = resolve(
      projectRoot,
      "src/modules/canon/domain/nested/probe.ts",
    );
    const analysis = analyzeSourceImports(
      [
        'import "node:fs";',
        'import "@/modules";',
        'import "../../../../lib/storage";',
        'export * from "../../../../platform/database/internal";',
        'void import("../../../narrative");',
      ].join("\n"),
      importer,
    );

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.violations.map((item) => item.specifier)).toEqual([
      "node:fs",
      "@/modules",
      "../../../../lib/storage",
      "../../../../platform/database/internal",
      "../../../narrative",
    ]);
    expect(analysis.violations.every((item) => item.importer === importer)).toBe(
      true,
    );
  });

  it("拒绝无法静态解析的动态导入且不吞语法错误", () => {
    const importer = resolve(
      projectRoot,
      "src/modules/canon/domain/probe.ts",
    );

    expect(
      analyzeSourceImports("void import(target);", importer).violations,
    ).toHaveLength(1);
    expect(
      analyzeSourceImports("import {", importer).diagnostics.length,
    ).toBeGreaterThan(0);
  });

  it("领域层执行裸包白名单并允许 Node 纯类型", () => {
    const importer = resolve(
      projectRoot,
      "src/modules/canon/domain/probe.ts",
    );
    const rejected = analyzeSourceImports(
      [
        'import "fs";',
        'import "node:path";',
        'import "react";',
        'import "@tanstack/react-query";',
      ].join("\n"),
      importer,
    );
    const allowed = analyzeSourceImports(
      [
        'import type { PathLike } from "node:fs";',
        'import { z } from "zod";',
        "export type Probe = PathLike;",
        "void z.string();",
      ].join("\n"),
      importer,
    );

    expect(rejected.violations).toHaveLength(4);
    expect(allowed.violations).toEqual([]);
  });

  it("阻止模块和平台绕过其他公开入口", () => {
    const moduleImporter = resolve(
      projectRoot,
      "src/modules/projects/application/probe.ts",
    );
    const platformImporter = resolve(
      projectRoot,
      "src/platform/events/adapter.ts",
    );

    expect(
      analyzeSourceImports(
        [
          'export * from "../../canon/domain/internal";',
          'void import("@/platform/database/internal");',
        ].join("\n"),
        moduleImporter,
      ).violations,
    ).toHaveLength(2);
    expect(
      analyzeSourceImports(
        'import "../database/internal";',
        platformImporter,
      ).violations,
    ).toHaveLength(1);
  });

  it("基于绝对路径拒绝四种公开入口绕过写法", () => {
    const importer = resolve(
      projectRoot,
      "src/modules/projects/application/probe.ts",
    );
    const analysis = analyzeSourceImports(
      [
        'import "../../canon";',
        'import "@/modules/canon/index.ts";',
        'import "@/modules/projects/domain/internal";',
        'import "@/platform/database/index.ts";',
      ].join("\n"),
      importer,
    );

    expect(isAbsolute(importer)).toBe(true);
    expect(analysis.violations).toHaveLength(4);
  });

  it("逐文件扫描当前 src 的全部导入边界", () => {
    const analysis = analyzeProjectSources(projectRoot);

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.violations).toEqual([]);
  });
});
