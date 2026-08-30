import type {
  AiTextPort,
  AiTextRequest,
  AiTextResponse,
} from "@/platform/ai";

export interface FakeAiPort extends AiTextPort {
  readonly requests: readonly AiTextRequest[];
}

export function createFakeAiPort(
  preparedTexts: readonly string[] = [],
): FakeAiPort {
  const responses = [...preparedTexts];
  const requests: AiTextRequest[] = [];

  return {
    requests,
    async generateText(request): Promise<AiTextResponse> {
      requests.push({ ...request });
      const text = responses.shift();

      if (text === undefined) {
        throw new Error("Fake AI 没有可用响应");
      }

      return { text };
    },
  };
}
