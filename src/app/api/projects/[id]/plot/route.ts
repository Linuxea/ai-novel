import { NextRequest, NextResponse } from "next/server";
import { listPlotPoints, upsertPlotPoint } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const plot = await listPlotPoints(id);
  return NextResponse.json({ plot });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json(
      { error: "缺少必填字段 title" },
      { status: 400 },
    );
  }
  try {
    const point = await upsertPlotPoint(id, body);
    return NextResponse.json({ plot: point }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
