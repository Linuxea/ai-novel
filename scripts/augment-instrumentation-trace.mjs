import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

const projectRoot = process.cwd();
const migrationsDirectory = resolve(projectRoot, "drizzle");
const distDirectory = resolve(
  projectRoot,
  process.env.NEXT_DIST_DIR?.trim() || ".next",
);
const tracePath = resolve(
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

const migrationAssets = listFiles(migrationsDirectory);
if (migrationAssets.length === 0) {
  throw new Error("未找到 Drizzle 迁移资产");
}

const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const files = new Set(trace.files);
for (const asset of migrationAssets) {
  files.add(
    relative(dirname(tracePath), asset),
  );
}
writeFileSync(
  tracePath,
  JSON.stringify({
    ...trace,
    files: [...files].sort(),
  }),
);
