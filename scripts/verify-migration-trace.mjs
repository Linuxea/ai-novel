import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = process.cwd();
const migrationsDirectory = resolve(projectRoot, "drizzle");
const distDirectory = resolve(
  projectRoot,
  process.env.NEXT_DIST_DIR?.trim() || ".next",
);
const instrumentationTracePath = resolve(
  distDirectory,
  "server/instrumentation.js.nft.json",
);

function listFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry) => {
      const filePath = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(filePath) : [filePath];
    },
  );
}

function traceIncludesMigrations(tracePath, migrationAssets) {
  const parsed = JSON.parse(readFileSync(tracePath, "utf8"));
  const tracedFiles = new Set(
    parsed.files.map((filePath) =>
      resolve(dirname(tracePath), filePath),
    ),
  );
  return migrationAssets.every((asset) => tracedFiles.has(asset));
}

function main() {
  const migrationAssets = listFiles(migrationsDirectory);
  if (migrationAssets.length === 0) {
    throw new Error("未找到 Drizzle 迁移资产");
  }

  if (!existsSync(instrumentationTracePath)) {
    throw new Error("未找到 instrumentation NFT trace");
  }
  if (
    !traceIncludesMigrations(
      instrumentationTracePath,
      migrationAssets,
    )
  ) {
    throw new Error(
      "instrumentation trace 未完整包含 Drizzle SQL/meta 迁移资产",
    );
  }

  process.stdout.write(
    `迁移 trace 校验通过: server/instrumentation.js.nft.json（${migrationAssets.length} 个资产）\n`,
  );
}

try {
  main();
} catch (error) {
  const message =
    error instanceof Error ? error.message : "迁移 trace 校验失败";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
