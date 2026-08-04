import { NextRequest, NextResponse } from "next/server";
import { ResolvePlotNoteSchema } from "@/lib/api-schemas";
import {
  handleRouteError,
  parseJson,
} from "@/lib/api-route";
import { resolvePlotNoteCommand } from "@/lib/application/project-commands";
import type { PlotNoteMutationResponse } from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string; noteId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id, noteId } = await params;
  try {
    const { chapterId } = await parseJson(req, ResolvePlotNoteSchema);
    const result = await resolvePlotNoteCommand(id, noteId, chapterId);
    return NextResponse.json(result satisfies PlotNoteMutationResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}
