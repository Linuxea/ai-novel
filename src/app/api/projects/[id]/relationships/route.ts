import { NextRequest, NextResponse } from "next/server";
import { upsertRelationship } from "@/lib/storage";
import { UpsertRelationshipApiSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string }> };

/** 为某角色添加关系 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, UpsertRelationshipApiSchema);
    const character = await upsertRelationship(id, body.characterId, {
      targetId: body.targetId,
      targetName: body.targetName,
      type: body.type,
      description: body.description,
    });
    if (!character) {
      return NextResponse.json({ error: "未找到发起方角色" }, { status: 404 });
    }
    return NextResponse.json({ character }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
