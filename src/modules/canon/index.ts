import type { ModuleEntrypoint } from "@/shared/contracts";

export const canonModule = {
  name: "canon",
  publicPath: "@/modules/canon",
} as const satisfies ModuleEntrypoint<"canon">;
