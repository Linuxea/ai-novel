import type {
  Chapter,
  Character,
  ConsistencyReport,
  PlotNote,
  Project,
  ProjectData,
  WorldSection,
} from "@/lib/types";

export type ProjectDataResponse = ProjectData;

export interface ChapterMutationResponse {
  project: Project;
  chapter: Chapter;
}

export interface CreateChapterResponse extends ChapterMutationResponse {
  chapters: Chapter[];
}

export interface DeleteChapterResponse {
  project: Project;
  deletedChapterId: string;
  chapters: Chapter[];
}

export interface CharacterMutationResponse {
  project: Project;
  character: Character;
}

export interface DeleteCharacterResponse {
  project: Project;
  deletedCharacterId: string;
  characters: Character[];
  chapters: Chapter[];
  plotNotes: PlotNote[];
}

export interface WorldMutationResponse {
  project: Project;
  section: WorldSection;
}

export interface DeleteWorldResponse {
  project: Project;
  deletedSectionId: string;
  worldbuilding: WorldSection[];
}

export interface PlotNoteMutationResponse {
  project: Project;
  note: PlotNote;
}

export interface DeletePlotNoteResponse {
  project: Project;
  deletedNoteId: string;
  plotNotes: PlotNote[];
}

export interface ConsistencyCheckMutationResponse {
  project: Project;
  report: ConsistencyReport;
  plotNotes: PlotNote[];
}
