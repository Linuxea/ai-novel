import { NextRequest, NextResponse } from "next/server";
import {
  deleteChapterCommand,
  updateChapterCommand,
} from "@/lib/application/project-commands";
import { UpdateChapterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type {
  ChapterMutationResponse,
  DeleteChapterResponse,
} from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string; chapterId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const body = await parseJson(req, UpdateChapterSchema);
    const result = await updateChapterCommand(id, chapterId, body);
    const response = result satisfies ChapterMutationResponse;
    return NextResponse.json(response);
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const result = await deleteChapterCommand(id, chapterId);
    const response = result satisfies DeleteChapterResponse;
    return NextResponse.json(response);
  } catch (e) {
    return handleRouteError(e);
  }
}
