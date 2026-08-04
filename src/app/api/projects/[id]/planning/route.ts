import { NextRequest, NextResponse } from "next/server";
import { listPlotNotes } from "@/lib/storage";
import { createPlotNoteCommand } from "@/lib/application/project-commands";
import { CreatePlotNoteSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { PlotNoteMutationResponse } from "@/lib/api-contracts";

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
    const result = await createPlotNoteCommand(id, body);
    return NextResponse.json(
      result satisfies PlotNoteMutationResponse,
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
