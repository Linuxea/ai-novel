import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/rag/chunk";

describe("chunkText", () => {
  it("carries the previous paragraph into the next chunk when it fits", () => {
    expect(chunkText("aaaa\n\nbbbb\n\ncccc", 10)).toEqual([
      "aaaa\n\nbbbb",
      "bbbb\n\ncccc",
    ]);
  });

  it("does not create an oversized overlap chunk", () => {
    const chunks = chunkText("aaaaaa\n\nbbbbbb", 8);
    expect(chunks).toEqual(["aaaaaa", "bbbbbb"]);
    expect(chunks.every((chunk) => chunk.length <= 8)).toBe(true);
  });
});
