import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorldSectionCommand,
  updateWorldSectionCommand,
} from "@/lib/application/project-commands";
import { UpdateWorldSectionSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type {
  DeleteWorldResponse,
  WorldMutationResponse,
} from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, sectionId } = await params;
  try {
    const body = await parseJson(req, UpdateWorldSectionSchema);
    const result = await updateWorldSectionCommand(id, sectionId, body);
    return NextResponse.json(result satisfies WorldMutationResponse);
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, sectionId } = await params;
  try {
    const result = await deleteWorldSectionCommand(id, sectionId);
    return NextResponse.json(result satisfies DeleteWorldResponse);
  } catch (e) {
    return handleRouteError(e);
  }
}
