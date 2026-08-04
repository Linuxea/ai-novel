/** RAG 纯计算层：类型 + 切片 + 中文分词 + BM25。
 *  不依赖 storage / server-only，可被 storage.ts 与 retrieve.ts 共同导入而不产生循环依赖。 */

export type RagMode = "off" | "bm25" | "embed";

export type RagSource = "chapter" | "world" | "plot" | "summary";

export interface RagChunk {
  id: string;
  source: RagSource;
  ownerId: string;
  ownerTitle: string;
  chapterOrder?: number;
  text: string;
}

export interface RagIndexRecord {
  chunk: RagChunk;
  updatedAt: string;
  /** embed 模式下的向量（BM25 模式留空） */
  embedding?: number[];
  embeddedAt?: string;
}

export interface RagMeta {
  mode: RagMode;
  builtAt: string;
  chunkCount: number;
}

export interface RagHit {
  source: RagSource;
  ownerTitle: string;
  chapterOrder?: number;
  text: string;
  score: number;
}

export interface RagQuery {
  outline: string;
  characterNames: string[];
  pendingForeshadowTitles: string[];
}

const CHUNK_MAX_LEN = 400;

/** 按段落聚合切片，目标 ~400 字/片，段间 overlap 1 段 */
export function chunkText(
  text: string,
  maxLen = CHUNK_MAX_LEN,
): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  let bufParas: string[] = [];

  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
    bufParas = [];
  };

  for (const p of paras) {
    if (p.length > maxLen) {
      flush();
      for (const piece of splitLongPara(p, maxLen)) chunks.push(piece);
      continue;
    }
    if (buf && (buf + "\n\n" + p).length > maxLen) {
      flush();
      // overlap：保留上一块最后一段作为新块开头
      if (bufParas.length) {
        const last = bufParas[bufParas.length - 1];
        buf = last;
        bufParas = [last];
      }
    }
    buf = buf ? buf + "\n\n" + p : p;
    bufParas.push(p);
  }
  flush();
  return chunks;
}

/** 切分超长段：优先在句末标点断句 */
function splitLongPara(p: string, maxLen: number): string[] {
  const out: string[] = [];
  const sentences = p.split(/(?<=[。！？；…\n])/).filter((s) => s.trim());
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > maxLen) {
      out.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
    while (cur.length > maxLen) {
      out.push(cur.slice(0, maxLen).trim());
      cur = cur.slice(maxLen);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * 中文分词：已知角色名/别名作为整词命中（加权），其余用字 bigram 覆盖。
 * 纯字 bigram 对中文召回率不错，且零依赖（不引入 jieba native binding）。
 */
export function tokenize(text: string, knownNames: string[] = []): string[] {
  const tokens: string[] = [];
  // 角色名/别名整词命中（重复 3 次以提升权重，解决"主角名跨段召回"硬需求）
  for (const name of knownNames) {
    if (name.length > 0 && text.includes(name)) {
      for (let i = 0; i < 3; i++) tokens.push(name);
    }
  }
  const cleaned = text.replace(/\s+/g, "");
  for (let i = 0; i < cleaned.length - 1; i++) {
    tokens.push(cleaned.slice(i, i + 2));
  }
  return tokens;
}

/** 标准 BM25 评分。返回 docId → score 的 Map（仅含 score > 0 的文档）。 */
export function bm25Scores(
  queryTokens: string[],
  docs: { id: string; tokens: string[] }[],
  opts: { k1?: number; b?: number } = {},
): Map<string, number> {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const N = docs.length;
  const scores = new Map<string, number>();
  if (N === 0 || queryTokens.length === 0) return scores;

  const df = new Map<string, number>();
  let avgDl = 0;
  for (const d of docs) {
    avgDl += d.tokens.length;
    const seen = new Set(d.tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  avgDl = avgDl / N || 1;

  const querySet = new Set(queryTokens);
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) {
      if (querySet.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    let s = 0;
    for (const [t, f] of tf) {
      const idf = Math.log(
        1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5),
      );
      const denom = f + k1 * (1 - b + b * (d.tokens.length / avgDl));
      s += (idf * (f * (k1 + 1))) / denom;
    }
    if (s > 0) scores.set(d.id, s);
  }
  return scores;
}

/** 余弦相似度 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
