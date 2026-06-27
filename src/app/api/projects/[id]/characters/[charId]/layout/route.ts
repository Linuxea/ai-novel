import { NextRequest, NextResponse } from "next/server";
import { updateCharacterLayout } from "@/lib/storage";

type Params = { params: Promise<{ id: string; charId: string }> };

/** 保存角色在关系图谱中的拖拽位置 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  const body = await req.json().catch(() => ({}));
  await updateCharacterLayout(id, charId, {
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
  });
  return NextResponse.json({ success: true });
}
