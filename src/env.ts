import "server-only";

/** 服务端环境变量（仅在 route handler / server 端使用） */

function getEnv(key: string, fallback = ""): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

export const env = {
  AI_API_KEY: getEnv("AI_API_KEY"),
  AI_BASE_URL: getEnv(
    "AI_BASE_URL",
    "https://api.deepseek.com/v1",
  ),
  AI_MODEL: getEnv("AI_MODEL", "deepseek-v4-flash"),
  /** 数据存储根目录（项目根下的 data/） */
  DATA_DIR: getEnv("DATA_DIR", "data"),
  /** RAG 向量检索：OpenAI 兼容 embedding 端点（可指 localhost Ollama/Xinference 或云端 BGE） */
  EMBED_API_KEY: getEnv("EMBED_API_KEY"),
  EMBED_BASE_URL: getEnv("EMBED_BASE_URL", ""),
  EMBED_MODEL: getEnv("EMBED_MODEL", "bge-m3"),
};

export function isAIConfigured(): boolean {
  return env.AI_API_KEY.length > 0;
}

/** embedding 是否已配置（ragMode=embed 时由 retrieve/rebuild 检查） */
export function isEmbedConfigured(): boolean {
  return (
    env.EMBED_API_KEY.length > 0 &&
    env.EMBED_BASE_URL.length > 0
  );
}
