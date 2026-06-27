import { NextRequest, NextResponse } from "next/server";
import { clearChat, readChat, writeChat } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** 读取对话历史 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const messages = await readChat(id);
  return NextResponse.json({ messages });
}

/** 保存对话历史（整体替换） */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({ messages: [] }));
  await writeChat(id, body.messages ?? []);
  return NextResponse.json({ success: true });
}

/** 清空对话历史 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await clearChat(id);
  return NextResponse.json({ success: true });
}
