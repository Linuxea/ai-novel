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
};

export function isAIConfigured(): boolean {
  return env.AI_API_KEY.length > 0;
}
