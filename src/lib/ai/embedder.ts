import "server-only";
import { env, isEmbedConfigured } from "@/env";

export { isEmbedConfigured as isEmbedReady };

/**
 * 批量嵌入文本，调用 OpenAI 兼容的 /embeddings 端点（手写 fetch，不引入 SDK）。
 * 自动分批（每批 32 条）。未配置或失败时抛错，由调用方降级。
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!isEmbedConfigured()) {
    throw new Error("embedding 未配置（需 EMBED_API_KEY 与 EMBED_BASE_URL）");
  }
  const BATCH = 32;
  const out: number[][] = [];
  const base = env.EMBED_BASE_URL.replace(/\/$/, "");
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const resp = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.EMBED_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: env.EMBED_MODEL, input: slice }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(
        `embedding 请求失败 (${resp.status}): ${t.slice(0, 200)}`,
      );
    }
    const data = (await resp.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    const ordered = data.data.sort((a, b) => a.index - b.index);
    for (const d of ordered) out.push(d.embedding);
  }
  return out;
}
