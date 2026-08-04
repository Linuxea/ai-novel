import { NextRequest, NextResponse } from "next/server";
import {
  deleteCharacterCommand,
  updateCharacterCommand,
} from "@/lib/application/project-commands";
import { UpdateCharacterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type {
  CharacterMutationResponse,
  DeleteCharacterResponse,
} from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string; charId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  try {
    const body = await parseJson(req, UpdateCharacterSchema);
    const result = await updateCharacterCommand(id, charId, body);
    const response = result satisfies CharacterMutationResponse;
    return NextResponse.json(response);
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  try {
    const result = await deleteCharacterCommand(id, charId);
    const response = result satisfies DeleteCharacterResponse;
    return NextResponse.json(response);
  } catch (e) {
    return handleRouteError(e);
  }
}
