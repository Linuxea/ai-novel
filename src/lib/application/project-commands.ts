import "server-only";
import type {
  ChapterMutationResponse,
  CharacterMutationResponse,
  CreateChapterResponse,
  DeleteCharacterResponse,
  DeleteChapterResponse,
  DeletePlotNoteResponse,
  DeleteWorldResponse,
  PlotNoteMutationResponse,
  WorldMutationResponse,
} from "@/lib/api-contracts";
import type { Chapter, PlotNote, WorldSection } from "@/lib/types";
import {
  createChapter,
  createCharacter,
  createPlotNote,
  createWorldSection,
  deleteChapter,
  deleteCharacter,
  deletePlotNote,
  deleteWorldSection,
  getProject,
  listChapters,
  listCharacters,
  listPlotNotes,
  listWorldSections,
  NotFoundError,
  resolvePlotNote,
  RevisionConflictError,
  updateChapter,
  updateCharacter,
  updateCharacterLayout,
  updatePlotNote,
  updateWorldSection,
  upsertRelationship,
  withProjectTransaction,
  writeChapterContent,
  type RelationshipInput,
} from "@/lib/storage";

async function requireProject(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new NotFoundError("项目不存在");
  return project;
}

export function createCharacterCommand(
  projectId: string,
  input: Parameters<typeof createCharacter>[1],
): Promise<CharacterMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const character = await createCharacter(projectId, input);
    const project = await requireProject(projectId);
    return { project, character };
  });
}

export function updateCharacterCommand(
  projectId: string,
  characterId: string,
  input: Parameters<typeof updateCharacter>[2],
): Promise<CharacterMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const character = await updateCharacter(projectId, characterId, input);
    const project = await requireProject(projectId);
    return { project, character };
  });
}

export function deleteCharacterCommand(
  projectId: string,
  characterId: string,
): Promise<DeleteCharacterResponse> {
  return withProjectTransaction(projectId, async () => {
    await deleteCharacter(projectId, characterId);
    const project = await requireProject(projectId);
    const [characters, chapters, plotNotes] = await Promise.all([
      listCharacters(projectId),
      listChapters(projectId),
      listPlotNotes(projectId),
    ]);
    return {
      project,
      deletedCharacterId: characterId,
      characters,
      chapters,
      plotNotes,
    };
  });
}

export function updateCharacterLayoutCommand(
  projectId: string,
  characterId: string,
  position: { x: number; y: number },
): Promise<CharacterMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    await updateCharacterLayout(projectId, characterId, position);
    const characters = await listCharacters(projectId);
    const character = characters.find((item) => item.id === characterId);
    if (!character) throw new NotFoundError("角色不存在");
    const project = await requireProject(projectId);
    return { project, character };
  });
}

export function upsertRelationshipCommand(
  projectId: string,
  characterId: string,
  input: RelationshipInput,
): Promise<CharacterMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const character = await upsertRelationship(projectId, characterId, input);
    if (!character) throw new NotFoundError("未找到发起方角色");
    const project = await requireProject(projectId);
    return { project, character };
  });
}

export function createWorldSectionCommand(
  projectId: string,
  input: Parameters<typeof createWorldSection>[1],
): Promise<WorldMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const section = await createWorldSection(projectId, input);
    const project = await requireProject(projectId);
    return { project, section };
  });
}

export function updateWorldSectionCommand(
  projectId: string,
  sectionId: string,
  input: Partial<WorldSection>,
): Promise<WorldMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const section = await updateWorldSection(projectId, sectionId, input);
    const project = await requireProject(projectId);
    return { project, section };
  });
}

export function deleteWorldSectionCommand(
  projectId: string,
  sectionId: string,
): Promise<DeleteWorldResponse> {
  return withProjectTransaction(projectId, async () => {
    await deleteWorldSection(projectId, sectionId);
    const project = await requireProject(projectId);
    const worldbuilding = await listWorldSections(projectId);
    return { project, deletedSectionId: sectionId, worldbuilding };
  });
}

export function createPlotNoteCommand(
  projectId: string,
  input: Parameters<typeof createPlotNote>[1],
): Promise<PlotNoteMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const note = await createPlotNote(projectId, input);
    const project = await requireProject(projectId);
    return { project, note };
  });
}

export function updatePlotNoteCommand(
  projectId: string,
  noteId: string,
  input: Partial<PlotNote>,
): Promise<PlotNoteMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const note = await updatePlotNote(projectId, noteId, input);
    const project = await requireProject(projectId);
    return { project, note };
  });
}

export function resolvePlotNoteCommand(
  projectId: string,
  noteId: string,
  chapterId: string,
): Promise<PlotNoteMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const note = await resolvePlotNote(projectId, noteId, chapterId);
    const project = await requireProject(projectId);
    return { project, note };
  });
}

export function deletePlotNoteCommand(
  projectId: string,
  noteId: string,
): Promise<DeletePlotNoteResponse> {
  return withProjectTransaction(projectId, async () => {
    await deletePlotNote(projectId, noteId);
    const project = await requireProject(projectId);
    const plotNotes = await listPlotNotes(projectId);
    return { project, deletedNoteId: noteId, plotNotes };
  });
}

export function createChapterCommand(
  projectId: string,
  input: Parameters<typeof createChapter>[1],
): Promise<CreateChapterResponse> {
  return withProjectTransaction(projectId, async () => {
    const chapter = await createChapter(projectId, input);
    const project = await requireProject(projectId);
    const chapters = await listChapters(projectId);
    return { project, chapter, chapters };
  });
}

export function updateChapterCommand(
  projectId: string,
  chapterId: string,
  input: Partial<Chapter>,
): Promise<ChapterMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const chapter = await updateChapter(projectId, chapterId, input);
    const project = await requireProject(projectId);
    return { project, chapter };
  });
}

export function updateChapterOutlineCommand(
  projectId: string,
  chapterId: string,
  outline: string,
  options: {
    expectedProjectRevision: number;
    expectedContentRevision: number;
    expectedOutline: string;
  },
): Promise<ChapterMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const project = await requireProject(projectId);
    if (project.revision !== options.expectedProjectRevision) {
      throw new RevisionConflictError(
        options.expectedProjectRevision,
        project.revision,
        "大纲生成期间项目设定已变化，本次结果已丢弃",
      );
    }
    const chapters = await listChapters(projectId);
    const chapter = chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new NotFoundError("章节不存在");
    if (
      chapter.contentRevision !== options.expectedContentRevision ||
      chapter.outline !== options.expectedOutline
    ) {
      throw new RevisionConflictError(
        options.expectedContentRevision,
        chapter.contentRevision,
        "大纲生成期间正文或原大纲已变化，本次结果已丢弃",
      );
    }
    const updated = await updateChapter(projectId, chapterId, { outline });
    const updatedProject = await requireProject(projectId);
    return { project: updatedProject, chapter: updated };
  });
}

export function deleteChapterCommand(
  projectId: string,
  chapterId: string,
): Promise<DeleteChapterResponse> {
  return withProjectTransaction(projectId, async () => {
    await deleteChapter(projectId, chapterId);
    const project = await requireProject(projectId);
    const chapters = await listChapters(projectId);
    return { project, deletedChapterId: chapterId, chapters };
  });
}

export function writeChapterContentCommand(
  projectId: string,
  chapterId: string,
  content: string,
  expectedRevision: number,
): Promise<ChapterMutationResponse> {
  return withProjectTransaction(projectId, async () => {
    const chapter = await writeChapterContent(
      projectId,
      chapterId,
      content,
      expectedRevision,
    );
    const project = await requireProject(projectId);
    return { project, chapter };
  });
}
