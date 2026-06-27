import { NextRequest, NextResponse } from "next/server";
import { deleteCharacter, upsertCharacter } from "@/lib/storage";

type Params = { params: Promise<{ id: string; charId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  const body = await req.json().catch(() => ({}));
  const character = await upsertCharacter(id, { ...body, id: charId });
  return NextResponse.json({ character });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  await deleteCharacter(id, charId);
  return NextResponse.json({ success: true });
}
