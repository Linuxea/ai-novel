import { NextRequest } from "next/server";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import { buildTools } from "@/lib/ai/tools";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { getProject, getProjectData } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAIConfigured()) {
    return Response.json(
      {
        error:
          "尚未配置 AI。请在 .env.local 中设置 AI_API_KEY / AI_BASE_URL / AI_MODEL 后重启。",
      },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const projectId: string | undefined = body.projectId;
  const messages = body.messages;

  if (!projectId || !Array.isArray(messages)) {
    return Response.json({ error: "缺少 projectId 或 messages" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const data = (await getProjectData(projectId))!;

  const result = streamText({
    model: getModel(project.aiModel || undefined),
    system: buildSystemPrompt(data),
    temperature: project.temperature ?? 0.8,
    messages: await convertToModelMessages(messages),
    tools: buildTools(projectId),
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
