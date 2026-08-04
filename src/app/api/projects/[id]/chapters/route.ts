import { NextRequest, NextResponse } from "next/server";
import { listChapters } from "@/lib/storage";
import { createChapterCommand } from "@/lib/application/project-commands";
import { CreateChapterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { CreateChapterResponse } from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const chapters = await listChapters(id);
    return NextResponse.json({ chapters });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, CreateChapterSchema);
    const result = await createChapterCommand(id, body);
    const response = result satisfies CreateChapterResponse;
    return NextResponse.json(response, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
