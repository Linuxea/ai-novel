import { NextRequest, NextResponse } from "next/server";
import { createChapter, listChapters } from "@/lib/storage";
import { CreateChapterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

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
    const chapter = await createChapter(id, body);
    return NextResponse.json({ chapter }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
