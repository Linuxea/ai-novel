import { NextRequest, NextResponse } from "next/server";
import { listCharacters, upsertCharacter } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const characters = await listCharacters(id);
  return NextResponse.json({ characters });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json(
      { error: "缺少必填字段 name" },
      { status: 400 },
    );
  }
  try {
    const character = await upsertCharacter(id, body);
    return NextResponse.json({ character }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
