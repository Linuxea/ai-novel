import "server-only";
import { readRagIndex } from "@/lib/storage";
import { isEmbedReady, embedBatch } from "@/lib/ai/embedder";
import {
  bm25Scores,
  cosine,
  tokenize,
  type RagHit,
  type RagQuery,
} from "@/lib/rag/chunk";

/** 同 owner 最多保留 2 片，避免单章刷屏挤占 context 预算 */
function dedupePerOwner(ranked: RagHit[], topK: number): RagHit[] {
  const perOwner = new Map<string, RagHit[]>();
  for (const h of ranked) {
    const key = `${h.source}:${h.ownerTitle}`;
    const arr = perOwner.get(key) ?? [];
    if (arr.length < 2) arr.push(h);
    perOwner.set(key, arr);
  }
  return [...perOwner.values()]
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * 检索与当前章相关的片段。绝不抛错——任何失败均返回 []，由调用方降级为不注入。
 * @param mode "bm25" 本地关键词；"embed" 向量（需配置 EMBED_*）
 */
export async function retrieveContext(
  projectId: string,
  query: RagQuery,
  topK: number,
  mode: "bm25" | "embed" = "bm25",
): Promise<RagHit[]> {
  try {
    const records = await readRagIndex(projectId);
    if (records.length === 0) return [];

    if (mode === "embed") {
      if (!isEmbedReady()) return [];
      const queryText = [
        query.outline,
        ...query.characterNames,
        ...query.pendingForeshadowTitles,
      ]
        .filter(Boolean)
        .join("\n");
      const [queryEmb] = await embedBatch([queryText]);

      const ranked = records
        .filter((r) => r.embedding && r.embedding.length)
        .map((r) => ({
          chunk: r.chunk,
          score: cosine(queryEmb, r.embedding!),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      return dedupePerOwner(
        ranked.map((x) => ({
          source: x.chunk.source,
          ownerTitle: x.chunk.ownerTitle,
          chapterOrder: x.chunk.chapterOrder,
          text: x.chunk.text,
          score: x.score,
        })),
        topK,
      );
    }

    // BM25
    const knownNames = query.characterNames;
    const docs = records.map((r) => ({
      id: r.chunk.id,
      tokens: tokenize(r.chunk.text, knownNames),
    }));
    const queryText = [
      query.outline,
      ...query.characterNames,
      ...query.pendingForeshadowTitles,
    ]
      .filter(Boolean)
      .join("\n");
    const queryTokens = tokenize(queryText, knownNames);
    const scores = bm25Scores(queryTokens, docs);

    const ranked = records
      .map((r) => ({
        chunk: r.chunk,
        score: scores.get(r.chunk.id) ?? 0,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return dedupePerOwner(
      ranked.map((x) => ({
        source: x.chunk.source,
        ownerTitle: x.chunk.ownerTitle,
        chapterOrder: x.chunk.chapterOrder,
        text: x.chunk.text,
        score: x.score,
      })),
      topK,
    );
  } catch {
    return [];
  }
}
