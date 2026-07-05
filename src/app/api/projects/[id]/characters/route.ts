import { NextRequest, NextResponse } from "next/server";
import { createCharacter, listCharacters } from "@/lib/storage";
import { CreateCharacterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

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
    const character = await createCharacter(id, body);
    return NextResponse.json({ character }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
