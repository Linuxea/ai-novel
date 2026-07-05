import { NextRequest, NextResponse } from "next/server";
import { clearChat, readChat, writeChat } from "@/lib/storage";
import { SaveChatSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string }> };

/** 读取对话历史 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const messages = await readChat(id);
    return NextResponse.json({ messages });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 保存对话历史（整体替换） */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, SaveChatSchema);
    await writeChat(id, body.messages);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 清空对话历史 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await clearChat(id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
