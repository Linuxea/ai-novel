import { NextRequest, NextResponse } from "next/server";
import { listChapters, upsertChapter } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const chapters = await listChapters(id);
  return NextResponse.json({ chapters });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const chapter = await upsertChapter(id, body);
  return NextResponse.json({ chapter }, { status: 201 });
}
