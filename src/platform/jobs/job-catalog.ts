import { z } from "zod";

export interface JobCatalogEntry<
  TPayloadSchema extends z.ZodType = z.ZodType,
  TResultSchema extends z.ZodType = z.ZodType,
> {
  readonly payloadSchema: TPayloadSchema;
  readonly resultSchema: TResultSchema;
}

export type JobCatalog = Record<string, JobCatalogEntry>;

export type JobCatalogPayload<
  TCatalog extends JobCatalog,
  TKey extends keyof TCatalog,
> = z.output<TCatalog[TKey]["payloadSchema"]>;

export type JobCatalogInput<
  TCatalog extends JobCatalog,
  TKey extends keyof TCatalog,
> = z.input<TCatalog[TKey]["payloadSchema"]>;

export type JobCatalogResult<
  TCatalog extends JobCatalog,
  TKey extends keyof TCatalog,
> = z.output<TCatalog[TKey]["resultSchema"]>;

export class JobPayloadCompatibilityError extends Error {
  readonly code = "JOB_PAYLOAD_INCOMPATIBLE";

  constructor(
    readonly jobType: string,
    readonly idempotencyKey: string,
    details: string,
  ) {
    super(
      `幂等任务的已持久化 payload 与当前 JobCatalog 不兼容: ${details}`,
    );
    this.name = "JobPayloadCompatibilityError";
  }
}

export class JobPayloadSerializationError extends TypeError {
  readonly code = "JOB_PAYLOAD_NOT_JSON";

  constructor(readonly jobType: string) {
    super(`任务 ${jobType} 的 payload 必须可序列化为 JSON，不能是 undefined`);
    this.name = "JobPayloadSerializationError";
  }
}

export function defineJobCatalog<
  const TCatalog extends JobCatalog,
>(catalog: TCatalog): TCatalog {
  return catalog;
}
