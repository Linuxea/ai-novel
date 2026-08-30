import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  drizzle,
  type NodeSQLiteDatabase,
} from "drizzle-orm/node-sqlite";

export interface SqliteTestDatabase {
  readonly client: DatabaseSync;
  readonly database: NodeSQLiteDatabase;
  readonly directory: string;
  readonly filePath: string;
  dispose(): void;
}

export function createSqliteTestDatabase(): SqliteTestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "ai-novel-sqlite-"));
  const filePath = join(directory, "test.sqlite");
  const client = new DatabaseSync(filePath);
  const database = drizzle({ client });
  let closed = false;
  let disposed = false;

  return {
    client,
    database,
    directory,
    filePath,
    dispose() {
      if (disposed) {
        return;
      }

      if (!closed) {
        client.close();
        closed = true;
      }
      rmSync(directory, { force: true, recursive: true });
      disposed = true;
    },
  };
}
