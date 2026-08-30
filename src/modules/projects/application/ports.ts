import type { EventEnvelope } from "@/shared/contracts";
import type {
  NovelProject,
  ProjectStatus,
} from "../domain/project";

export interface ProjectTransaction {
  readonly resource: unknown;
}

export interface ProjectListFilter {
  readonly genre?: string;
  readonly includeArchived?: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly status?: ProjectStatus;
}

export interface ProjectPage {
  readonly catalogVersion: number;
  readonly fetchedAt?: number;
  readonly items: readonly NovelProject[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ProjectRepository {
  findById(projectId: string): NovelProject | undefined;
  insert(
    transaction: ProjectTransaction,
    project: NovelProject,
  ): number;
  list(filter: ProjectListFilter): ProjectPage;
  update(
    transaction: ProjectTransaction,
    project: NovelProject,
    expectedVersion: number,
  ): number | false;
}

export interface ProjectEventOutbox {
  enqueue(
    transaction: ProjectTransaction,
    envelope: EventEnvelope,
  ): void;
}

export interface ProjectUnitOfWork {
  run<TResult>(
    work: (transaction: ProjectTransaction) => TResult,
  ): TResult;
}
