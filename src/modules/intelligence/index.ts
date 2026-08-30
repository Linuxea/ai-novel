import type { ModuleEntrypoint } from "@/shared/contracts";

export const intelligenceModule = {
  name: "intelligence",
  publicPath: "@/modules/intelligence",
} as const satisfies ModuleEntrypoint<"intelligence">;
