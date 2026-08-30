import type { PlatformEntrypoint } from "../capabilities";

export const databasePlatform = {
  name: "database",
  publicPath: "@/platform/database",
} as const satisfies PlatformEntrypoint<"database">;

export {
  assertDatabaseIntegrity,
  backupDatabase,
  createSqliteDatabase,
  DatabaseCleanupError,
  DatabaseRestoreRollbackError,
  resolveDatabasePath,
  restoreDatabase,
} from "./database";
export type {
  CreateSqliteDatabaseOptions,
  DatabaseBackupResult,
  DatabaseIntegrityResult,
  DatabaseFileOperations,
  DatabasePathOptions,
  PlatformDatabase,
  RestoreDatabaseOptions,
  SqliteDatabaseConnection,
  SqliteUnitOfWork,
  UnitOfWorkContext,
} from "./database";
export {
  MigrationLeaseLostError,
  withMigrationLock,
} from "./migration-lock";
export type {
  MigrationLockHeartbeat,
  MigrationLockHeartbeatStartOptions,
  MigrationLockOptions,
} from "./migration-lock";
export {
  domainEvents,
  eventSchema,
  jobEvents,
  jobs,
  jobSchema,
  projectCatalogState,
  projectModelPreferences,
  projects,
  projectSchema,
  platformSchema,
} from "./schema";
export type { PlatformSchema } from "./schema";
export {
  closeDatabaseSingleton,
  getDatabaseSingleton,
} from "./singleton";
