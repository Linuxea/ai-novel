import { describe, expect, it } from "vitest";
import {
  parseGenerationEvent,
  serializeGenerationEvent,
  type GenerationEvent,
} from "@/lib/ai/generation-events";
import {
  createGenerationEventResponse,
  textStreamToGenerationResponse,
} from "@/lib/ai/generation-stream";

async function readEvents(response: Response): Promise<GenerationEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map(parseGenerationEvent);
}

describe("generation events", () => {
  const events: GenerationEvent[] = [
    { type: "delta", text: "正文" },
    { type: "progress", current: 2, total: 4 },
    { type: "error", code: "FAILED", message: "失败" },
    { type: "done", generationId: "run-1" },
  ];

  it.each(events)("round-trips $type", (event) => {
    expect(parseGenerationEvent(serializeGenerationEvent(event).trim())).toEqual(
      event,
    );
  });

  it("rejects malformed events", () => {
    expect(() => parseGenerationEvent('{"type":"delta"}')).toThrow(
      "生成服务返回了无效事件",
    );
  });

  it("emits done only after a successful text stream", async () => {
    async function* textStream() {
      yield "第一段";
      yield "第二段";
    }
    const events = await readEvents(
      textStreamToGenerationResponse(textStream(), "run-2"),
    );
    expect(events.at(-1)).toEqual({ type: "done", generationId: "run-2" });
  });

  it("emits an error without a done event when generation fails", async () => {
    const events = await readEvents(
      createGenerationEventResponse(async (emit) => {
        emit({ type: "delta", text: "部分正文" });
        throw new Error("provider failed");
      }),
    );
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });
});
