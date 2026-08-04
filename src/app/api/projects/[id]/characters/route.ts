import { NextRequest, NextResponse } from "next/server";
import { listCharacters } from "@/lib/storage";
import { createCharacterCommand } from "@/lib/application/project-commands";
import { CreateCharacterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { CharacterMutationResponse } from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const characters = await listCharacters(id);
    return NextResponse.json({ characters });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, CreateCharacterSchema);
    const result = await createCharacterCommand(id, body);
    const response = result satisfies CharacterMutationResponse;
    return NextResponse.json(response, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
