import {
  createSqliteDatabase,
  resolveDatabasePath,
  type CreateSqliteDatabaseOptions,
  type SqliteDatabaseConnection,
} from "./database";

let singleton: SqliteDatabaseConnection | undefined;

export function getDatabaseSingleton(
  options: CreateSqliteDatabaseOptions = {},
): SqliteDatabaseConnection {
  const requestedPath = resolveDatabasePath(options);
  if (singleton?.isOpen()) {
    if (singleton.filePath !== requestedPath) {
      throw new Error(
        `SQLite 单例已绑定 ${singleton.filePath}，不能切换到 ${requestedPath}`,
      );
    }
    return singleton;
  }

  singleton = createSqliteDatabase(options);
  return singleton;
}

export function closeDatabaseSingleton(): void {
  if (!singleton) {
    return;
  }
  singleton.close();
  singleton = undefined;
}
