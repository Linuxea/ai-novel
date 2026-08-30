import type { ModuleEntrypoint } from "@/shared/contracts";

export const narrativeModule = {
  name: "narrative",
  publicPath: "@/modules/narrative",
} as const satisfies ModuleEntrypoint<"narrative">;
