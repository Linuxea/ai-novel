import { NextRequest, NextResponse } from "next/server";
import { deletePlotNote, updatePlotNote } from "@/lib/storage";
import { UpdatePlotNoteSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string; noteId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, noteId } = await params;
  try {
    const body = await parseJson(req, UpdatePlotNoteSchema);
    const note = await updatePlotNote(id, noteId, body);
    return NextResponse.json({ note });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, noteId } = await params;
  try {
    await deletePlotNote(id, noteId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
