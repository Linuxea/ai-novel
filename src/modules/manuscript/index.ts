import type { ModuleEntrypoint } from "@/shared/contracts";

export const manuscriptModule = {
  name: "manuscript",
  publicPath: "@/modules/manuscript",
} as const satisfies ModuleEntrypoint<"manuscript">;
