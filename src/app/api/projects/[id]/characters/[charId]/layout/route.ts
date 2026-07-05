import { NextRequest, NextResponse } from "next/server";
import { updateCharacterLayout } from "@/lib/storage";
import { LayoutPositionSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string; charId: string }> };

/** 保存角色在关系图谱中的拖拽位置 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  try {
    const position = await parseJson(req, LayoutPositionSchema);
    await updateCharacterLayout(id, charId, position);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
