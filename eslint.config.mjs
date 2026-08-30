import { defineConfig, globalIgnores } from "eslint/config";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(projectRoot, "src");
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

function pathSegments(base, target) {
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

function isInside(base, target) {
  return pathSegments(base, target) !== undefined;
}

function resolveLocalTarget(importer, specifier) {
  if (specifier.startsWith("@/")) {
    return resolve(sourceRoot, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return resolve(dirname(importer), specifier);
  }
  return undefined;
}

function boundaryViolationReason(importer, specifier, isTypeOnly = false) {
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

  const target = resolveLocalTarget(importer, specifier);
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

const architecturePlugin = {
  rules: {
    "module-boundaries": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          violation: "{{reason}}",
        },
      },
      create(context) {
        const importer = context.physicalFilename ?? context.filename;

        function inspect(node, source, isTypeOnly = false) {
          const specifier =
            source?.type === "Literal" && typeof source.value === "string"
              ? source.value
              : undefined;
          const reason = boundaryViolationReason(
            importer,
            specifier,
            isTypeOnly,
          );
          if (reason) {
            context.report({
              node,
              messageId: "violation",
              data: { reason },
            });
          }
        }

        return {
          ImportDeclaration(node) {
            inspect(node, node.source, node.importKind === "type");
          },
          ExportNamedDeclaration(node) {
            if (node.source) {
              inspect(node, node.source, node.exportKind === "type");
            }
          },
          ExportAllDeclaration(node) {
            inspect(node, node.source, node.exportKind === "type");
          },
          ImportExpression(node) {
            inspect(node, node.source);
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      architecture: architecturePlugin,
    },
    rules: {
      "architecture/module-boundaries": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    ".playwright-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
