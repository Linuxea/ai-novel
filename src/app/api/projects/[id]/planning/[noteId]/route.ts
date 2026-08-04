import { NextRequest, NextResponse } from "next/server";
import {
  deletePlotNoteCommand,
  updatePlotNoteCommand,
} from "@/lib/application/project-commands";
import { UpdatePlotNoteSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type {
  DeletePlotNoteResponse,
  PlotNoteMutationResponse,
} from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string; noteId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, noteId } = await params;
  try {
    const body = await parseJson(req, UpdatePlotNoteSchema);
    const result = await updatePlotNoteCommand(id, noteId, body);
    return NextResponse.json(result satisfies PlotNoteMutationResponse);
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, noteId } = await params;
  try {
    const result = await deletePlotNoteCommand(id, noteId);
    return NextResponse.json(result satisfies DeletePlotNoteResponse);
  } catch (e) {
    return handleRouteError(e);
  }
}
