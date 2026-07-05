import { NextRequest, NextResponse } from "next/server";
import { createPlotNote, listPlotNotes } from "@/lib/storage";
import { CreatePlotNoteSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const notes = await listPlotNotes(id);
    return NextResponse.json({ notes });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, CreatePlotNoteSchema);
    const note = await createPlotNote(id, body);
    return NextResponse.json({ note }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
