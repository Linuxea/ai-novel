import "server-only";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { env } from "@/env";

/**
 * 创建 DeepSeek 模型客户端。
 * 通过 AI_BASE_URL / AI_API_KEY / AI_MODEL 配置。
 * 支持 deepseek-v4-flash（默认）与 deepseek-v4-pro；@ai-sdk/deepseek 会读取
 * reasoning_content 并转为 reasoning stream parts（thinking 模式）。
 */
export function getModel(modelOverride?: string) {
  const modelId =
    modelOverride && modelOverride.length > 0 ? modelOverride : env.AI_MODEL;

  const deepseek = createDeepSeek({
    apiKey: env.AI_API_KEY || "missing-key",
    baseURL: env.AI_BASE_URL,
  });
  return deepseek(modelId);
}

export { env };
