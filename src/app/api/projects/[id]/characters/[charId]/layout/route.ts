import { NextRequest, NextResponse } from "next/server";
import { updateCharacterLayoutCommand } from "@/lib/application/project-commands";
import { LayoutPositionSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { CharacterMutationResponse } from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string; charId: string }> };

/** 保存角色在关系图谱中的拖拽位置 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, charId } = await params;
  try {
    const position = await parseJson(req, LayoutPositionSchema);
    const result = await updateCharacterLayoutCommand(id, charId, position);
    return NextResponse.json(result satisfies CharacterMutationResponse);
  } catch (e) {
    return handleRouteError(e);
  }
}
