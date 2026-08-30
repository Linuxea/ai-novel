export const DOMAIN_MODULES = [
  "projects",
  "canon",
  "narrative",
  "manuscript",
  "changes",
  "intelligence",
] as const;

export type DomainModule = (typeof DOMAIN_MODULES)[number];

export interface ModuleEntrypoint<
  TName extends DomainModule = DomainModule,
> {
  readonly name: TName;
  readonly publicPath: `@/modules/${TName}`;
}
