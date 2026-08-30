export const PLATFORM_CAPABILITIES = [
  "database",
  "events",
  "jobs",
  "ai",
  "observability",
] as const;

export type PlatformCapabilityName =
  (typeof PLATFORM_CAPABILITIES)[number];

export interface PlatformEntrypoint<
  TName extends PlatformCapabilityName = PlatformCapabilityName,
> {
  readonly name: TName;
  readonly publicPath: `@/platform/${TName}`;
}
