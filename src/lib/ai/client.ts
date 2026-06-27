import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { env } from "@/env";

/**
 * 创建模型客户端。
 * 通过 AI_BASE_URL / AI_API_KEY / AI_MODEL 配置，支持 OpenAI / DeepSeek / Moonshot / Ollama 等。
 *
 * DeepSeek 全系列（deepseek-chat / deepseek-reasoner / deepseek-v4-pro 等）走 @ai-sdk/deepseek
 * provider：它会原生读取响应里的 reasoning_content 字段并转为 reasoning stream parts
 * （deepseek-v4 通过 modelId.includes("deepseek-v4") 自动识别）。
 * @ai-sdk/openai 不读该字段，会静默丢弃推理内容。
 *
 * 其他 OpenAI 兼容服务使用 .chat() 强制走 Chat Completions API（/v1/chat/completions），
 * 而非 OpenAI 专有的 Responses API（/v1/responses），后者只有 OpenAI 官方支持。
 */
export function getModel(modelOverride?: string) {
  const modelId =
    modelOverride && modelOverride.length > 0 ? modelOverride : env.AI_MODEL;

  if (/deepseek/i.test(modelId)) {
    const deepseek = createDeepSeek({
      apiKey: env.AI_API_KEY || "missing-key",
      baseURL: env.AI_BASE_URL,
    });
    return deepseek(modelId);
  }

  const openai = createOpenAI({
    apiKey: env.AI_API_KEY || "missing-key",
    baseURL: env.AI_BASE_URL,
  });
  return openai.chat(modelId);
}

export { env };
