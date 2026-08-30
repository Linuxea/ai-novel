import type { DomainModule } from "./modules";

export type AggregateVersion = number;

export interface AggregateIdentity {
  readonly module: DomainModule;
  readonly aggregateType: string;
  readonly aggregateId: string;
}

export interface VersionedAggregateRef extends AggregateIdentity {
  readonly version: AggregateVersion;
}

interface AtomicChangeBase {
  readonly aggregate: VersionedAggregateRef;
  readonly path: string;
}

export type AtomicChange =
  | (AtomicChangeBase & {
      readonly kind: "create";
      readonly before?: never;
      readonly after: unknown;
    })
  | (AtomicChangeBase & {
      readonly kind: "update";
      readonly before: unknown;
      readonly after: unknown;
    })
  | (AtomicChangeBase & {
      readonly kind: "delete";
      readonly before: unknown;
      readonly after?: never;
    });

export interface ChangeSet {
  readonly changeSetId: string;
  readonly projectId: string;
  readonly baseProjectVersion: AggregateVersion;
  readonly targetProjectVersion: AggregateVersion;
  readonly changes: readonly AtomicChange[];
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface AggregateSnapshot<TState = unknown> {
  readonly aggregate: VersionedAggregateRef;
  readonly state: TState;
  readonly contentHash: string;
  readonly capturedAt: string;
  readonly changeSetId?: string;
}
