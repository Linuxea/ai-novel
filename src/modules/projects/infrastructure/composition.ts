import { randomUUID } from "node:crypto";
import {
  getDatabaseSingleton,
  type SqliteDatabaseConnection,
  type UnitOfWorkContext,
} from "@/platform/database";
import { createOutboxRepository } from "@/platform/events";
import {
  createLogger,
  type Logger,
} from "@/platform/observability";
import {
  createProjectsApplication,
  type ProjectsApplication,
} from "../application/projects-application";
import type {
  ProjectEventOutbox,
  ProjectTransaction,
  ProjectUnitOfWork,
} from "../application/ports";
import { createSqliteProjectRepository } from "./sqlite-project-repository";

export interface ProjectsCompositionOptions {
  readonly causeIdGenerator?: () => string;
  readonly clock?: () => Date;
  readonly eventIdGenerator?: () => string;
  readonly idGenerator?: () => string;
  readonly logger?: Logger;
  readonly outbox?: ProjectEventOutbox;
}

function transactionResource(
  transaction: ProjectTransaction,
  connection: SqliteDatabaseConnection,
): UnitOfWorkContext {
  if (
    typeof transaction.resource !== "object" ||
    transaction.resource === null ||
    !("client" in transaction.resource) ||
    !("database" in transaction.resource)
  ) {
    throw new Error("项目 outbox 需要有效的 UnitOfWork 上下文");
  }
  const resource = transaction.resource as UnitOfWorkContext;
  if (
    resource.client !== connection.client ||
    !resource.client.isTransaction
  ) {
    throw new Error("项目事件必须在所属 UnitOfWork 内登记");
  }
  return resource;
}

export function composeProjectsApplication(
  connection: SqliteDatabaseConnection,
  options: ProjectsCompositionOptions = {},
): ProjectsApplication {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? createLogger({ clock });
  const repository = createSqliteProjectRepository(connection);
  const platformOutbox = createOutboxRepository(connection, { clock });
  const outbox: ProjectEventOutbox = options.outbox ?? {
    enqueue(transaction, envelope) {
      platformOutbox.enqueue(
        transactionResource(transaction, connection),
        envelope,
      );
    },
  };
  const unitOfWork: ProjectUnitOfWork = {
    run<TResult>(work: (transaction: ProjectTransaction) => TResult) {
      const sqliteWork = ((resource: UnitOfWorkContext) =>
        work({ resource })) as (
        resource: UnitOfWorkContext,
      ) => TResult extends PromiseLike<unknown> ? never : TResult;
      return connection.unitOfWork.run(sqliteWork);
    },
  };

  return createProjectsApplication({
    causeIdGenerator: options.causeIdGenerator ?? randomUUID,
    clock,
    eventIdGenerator: options.eventIdGenerator ?? randomUUID,
    idGenerator: options.idGenerator ?? randomUUID,
    onUnexpectedError(error, causeId) {
      logger.error("项目应用用例执行失败", { causeId, error });
    },
    outbox,
    repository,
    unitOfWork,
  });
}

export function getProjectsApplication(): ProjectsApplication {
  return composeProjectsApplication(getDatabaseSingleton());
}
