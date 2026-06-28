import { NextRequest, NextResponse } from "next/server";
import { listPlotNotes, upsertPlotNote } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const notes = await listPlotNotes(id);
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.title !== "string" ||
    !body.title.trim() ||
    typeof body.type !== "string"
  ) {
    return NextResponse.json(
      { error: "缺少必填字段 title / type" },
      { status: 400 },
    );
  }
  try {
    const note = await upsertPlotNote(id, body);
    return NextResponse.json({ note }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
