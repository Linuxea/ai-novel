import "server-only";
import {
  serializeGenerationEvent,
  type GenerationEvent,
} from "@/lib/ai/generation-events";

export type GenerationEventEmitter = (event: GenerationEvent) => void;

export function createGenerationEventResponse(
  run: (emit: GenerationEventEmitter) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  let active = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: GenerationEventEmitter = (event) => {
        if (!active) return;
        try {
          controller.enqueue(encoder.encode(serializeGenerationEvent(event)));
        } catch {
          active = false;
        }
      };
      try {
        await run(emit);
      } catch (error) {
        emit({
          type: "error",
          code: error instanceof Error && error.name === "AbortError"
            ? "ABORTED"
            : "GENERATION_FAILED",
          message: error instanceof Error && error.name === "AbortError"
            ? "生成已停止"
            : "生成中断，请稍后重试",
        });
      } finally {
        if (active) {
          active = false;
          controller.close();
        }
      }
    },
    cancel() {
      active = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function textStreamToGenerationResponse(
  textStream: AsyncIterable<string>,
  generationId: string,
): Response {
  return createGenerationEventResponse(async (emit) => {
    for await (const text of textStream) {
      emit({ type: "delta", text });
    }
    emit({ type: "done", generationId });
  });
}
