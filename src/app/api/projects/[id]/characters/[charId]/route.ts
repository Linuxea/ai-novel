import { NextRequest, NextResponse } from "next/server";
import { deleteCharacter, updateCharacter } from "@/lib/storage";
import { UpdateCharacterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string; charId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  try {
    const body = await parseJson(req, UpdateCharacterSchema);
    const character = await updateCharacter(id, charId, body);
    return NextResponse.json({ character });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  try {
    await deleteCharacter(id, charId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
