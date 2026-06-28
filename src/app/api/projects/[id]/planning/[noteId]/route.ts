import { NextRequest, NextResponse } from "next/server";
import { deletePlotNote, upsertPlotNote } from "@/lib/storage";

type Params = { params: Promise<{ id: string; noteId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, noteId } = await params;
  const body = await req.json().catch(() => ({}));
  const note = await upsertPlotNote(id, { ...body, id: noteId });
  return NextResponse.json({ note });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, noteId } = await params;
  await deletePlotNote(id, noteId);
  return NextResponse.json({ success: true });
}
