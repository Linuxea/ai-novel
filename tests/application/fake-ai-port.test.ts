import { describe, expect, it } from "vitest";
import { createFakeAiPort } from "../fixtures/fake-ai";

describe("Fake AI 应用测试端口", () => {
  it("按顺序返回预置文本并记录请求", async () => {
    const ai = createFakeAiPort(["第一段", "第二段"]);

    await expect(
      ai.generateText({ requestId: "request-1", prompt: "写一段开场" }),
    ).resolves.toEqual({ text: "第一段" });
    await expect(
      ai.generateText({ requestId: "request-2", prompt: "继续" }),
    ).resolves.toEqual({ text: "第二段" });
    expect(ai.requests).toEqual([
      { requestId: "request-1", prompt: "写一段开场" },
      { requestId: "request-2", prompt: "继续" },
    ]);
  });

  it("没有预置响应时以明确错误失败", async () => {
    const ai = createFakeAiPort();

    await expect(
      ai.generateText({ requestId: "request-3", prompt: "不会调用真实 AI" }),
    ).rejects.toThrow("Fake AI 没有可用响应");
  });
});
