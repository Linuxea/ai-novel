import { NextRequest, NextResponse } from "next/server";
import { upsertRelationship } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** 为某角色添加关系 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const character = await upsertRelationship(id, body.characterId, {
      targetName: body.targetName,
      type: body.type,
      description: body.description,
    });
    if (!character) {
      return NextResponse.json({ error: "未找到发起方角色" }, { status: 404 });
    }
    return NextResponse.json({ character }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
