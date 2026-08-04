export type GenerationEvent =
  | { type: "delta"; text: string }
  | { type: "progress"; current: number; total: number }
  | { type: "error"; code: string; message: string }
  | { type: "done"; generationId: string };

export function serializeGenerationEvent(event: GenerationEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseGenerationEvent(line: string): GenerationEvent {
  const value = JSON.parse(line) as Record<string, unknown>;
  switch (value.type) {
    case "delta":
      if (typeof value.text === "string") {
        return { type: "delta", text: value.text };
      }
      break;
    case "progress":
      if (
        typeof value.current === "number" &&
        typeof value.total === "number"
      ) {
        return {
          type: "progress",
          current: value.current,
          total: value.total,
        };
      }
      break;
    case "error":
      if (typeof value.code === "string" && typeof value.message === "string") {
        return { type: "error", code: value.code, message: value.message };
      }
      break;
    case "done":
      if (typeof value.generationId === "string") {
        return { type: "done", generationId: value.generationId };
      }
      break;
  }
  throw new Error("生成服务返回了无效事件");
}
