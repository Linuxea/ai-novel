import { NextRequest } from "next/server";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import { buildTools } from "@/lib/ai/tools";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { getProject, getProjectData } from "@/lib/storage";
import { ChatRequestSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import { CHAT_HISTORY_LIMIT } from "@/lib/types";

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

  let body;
  try {
    body = await parseJson(req, ChatRequestSchema);
  } catch (e) {
    return handleRouteError(e);
  }
  const { projectId, messages } = body;

  const project = await getProject(projectId);
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const data = await getProjectData(projectId);
  if (!data) {
    return Response.json({ error: "项目数据读取失败" }, { status: 404 });
  }

  let result;
  try {
    result = streamText({
      model: getModel(project.aiModel || undefined),
      system: buildSystemPrompt(data),
      temperature: project.temperature ?? 0.8,
      messages: await convertToModelMessages(
        messages.slice(-CHAT_HISTORY_LIMIT) as never[],
      ),
      tools: buildTools(projectId),
      stopWhen: stepCountIs(6),
    });
  } catch (e) {
    return Response.json(
      { error: `模型初始化失败：${(e as Error).message}` },
      { status: 500 },
    );
  }

  return result.toUIMessageStreamResponse({ sendReasoning: true });
}
