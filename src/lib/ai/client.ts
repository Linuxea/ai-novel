import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/env";

/**
 * 创建 OpenAI 兼容客户端。
 * 通过 AI_BASE_URL / AI_API_KEY / AI_MODEL 配置，支持 OpenAI / DeepSeek / Moonshot / Ollama 等。
 *
 * 使用 .chat() 强制走 Chat Completions API（/v1/chat/completions），
 * 而非 OpenAI 专有的 Responses API（/v1/responses），后者只有 OpenAI 官方支持，
 * DeepSeek / Moonshot / Ollama 等兼容服务均不支持。
 */
export function getModel(modelOverride?: string) {
  const openai = createOpenAI({
    apiKey: env.AI_API_KEY || "missing-key",
    baseURL: env.AI_BASE_URL,
  });
  const modelId =
    modelOverride && modelOverride.length > 0 ? modelOverride : env.AI_MODEL;
  return openai.chat(modelId);
}

export { env };
