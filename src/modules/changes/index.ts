import type { ModuleEntrypoint } from "@/shared/contracts";

export const changesModule = {
  name: "changes",
  publicPath: "@/modules/changes",
} as const satisfies ModuleEntrypoint<"changes">;
