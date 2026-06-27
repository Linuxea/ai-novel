import { NextRequest, NextResponse } from "next/server";
import { deletePlotPoint, upsertPlotPoint } from "@/lib/storage";

type Params = { params: Promise<{ id: string; plotId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, plotId } = await params;
  const body = await req.json().catch(() => ({}));
  const point = await upsertPlotPoint(id, { ...body, id: plotId });
  return NextResponse.json({ plot: point });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, plotId } = await params;
  await deletePlotPoint(id, plotId);
  return NextResponse.json({ success: true });
}
