import { canonModule } from "@/modules/canon";
import { changesModule } from "@/modules/changes";
import { intelligenceModule } from "@/modules/intelligence";
import { manuscriptModule } from "@/modules/manuscript";
import { narrativeModule } from "@/modules/narrative";
import { projectsModule } from "@/modules/projects";

export {
  canonModule,
  changesModule,
  intelligenceModule,
  manuscriptModule,
  narrativeModule,
  projectsModule,
};

export const MODULE_ENTRYPOINTS = [
  projectsModule,
  canonModule,
  narrativeModule,
  manuscriptModule,
  changesModule,
  intelligenceModule,
] as const;
