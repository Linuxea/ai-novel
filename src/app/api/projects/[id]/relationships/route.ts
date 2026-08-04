import { NextRequest, NextResponse } from "next/server";
import { upsertRelationshipCommand } from "@/lib/application/project-commands";
import { UpsertRelationshipApiSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { CharacterMutationResponse } from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string }> };

/** 为某角色添加关系 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, UpsertRelationshipApiSchema);
    const result = await upsertRelationshipCommand(id, body.characterId, {
      targetId: body.targetId,
      targetName: body.targetName,
      type: body.type,
      description: body.description,
    });
    return NextResponse.json(
      result satisfies CharacterMutationResponse,
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
