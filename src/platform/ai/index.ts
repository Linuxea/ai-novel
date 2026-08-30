import type { PlatformEntrypoint } from "../capabilities";

export interface AiTextRequest {
  readonly requestId: string;
  readonly prompt: string;
  readonly system?: string;
}

export interface AiTextResponse {
  readonly text: string;
}

export interface AiTextPort {
  generateText(request: AiTextRequest): Promise<AiTextResponse>;
}

export const aiPlatform = {
  name: "ai",
  publicPath: "@/platform/ai",
} as const satisfies PlatformEntrypoint<"ai">;
