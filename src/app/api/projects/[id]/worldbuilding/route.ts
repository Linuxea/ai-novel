import { NextRequest, NextResponse } from "next/server";
import { listWorldSections, upsertWorldSection } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const sections = await listWorldSections(id);
  return NextResponse.json({ sections });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const section = await upsertWorldSection(id, body);
  return NextResponse.json({ section }, { status: 201 });
}
