import { describe, expect, it } from "vitest";
import {
  createLogger,
  getCorrelationContext,
  sanitizeSensitiveString,
  withCorrelationContext,
  type LogRecord,
} from "@/platform/observability";

describe("可观测性平台", () => {
  it("把关联上下文合并到结构化日志且不泄漏到调用外", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      clock: () => new Date("2026-08-30T00:00:00.000Z"),
      sink: (record) => records.push(record),
    });

    await withCorrelationContext(
      {
        changeSetId: "change-set-1",
        generationId: "generation-1",
        jobId: "job-1",
        requestId: "request-1",
      },
      async () => {
        expect(getCorrelationContext()?.requestId).toBe("request-1");
        logger.info("任务开始", { phase: "prepare" });
        await Promise.resolve();
        logger.warn("任务继续");
      },
    );
    logger.info("上下文外");

    expect(records[0]).toMatchObject({
      changeSetId: "change-set-1",
      fields: { phase: "prepare" },
      generationId: "generation-1",
      jobId: "job-1",
      level: "info",
      message: "任务开始",
      requestId: "request-1",
      timestamp: "2026-08-30T00:00:00.000Z",
    });
    expect(records[1]?.requestId).toBe("request-1");
    expect(records[2]?.requestId).toBeUndefined();
  });

  it("安全序列化 Error 并递归脱敏凭据和 authorization", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: (record) => records.push(record),
    });
    const error = Object.assign(new Error("provider failed"), {
      code: "PROVIDER_BUSY",
    });

    logger.error("调用失败", {
      apiKey: "secret-key",
      authorization: "Bearer secret-token",
      error,
      nested: {
        password: "secret-password",
        safe: "visible",
      },
    });

    expect(records[0]?.fields).toEqual({
      apiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      error: expect.objectContaining({
        code: "PROVIDER_BUSY",
        message: "provider failed",
        name: "Error",
      }),
      nested: {
        password: "[REDACTED]",
        safe: "visible",
      },
    });
    expect(JSON.stringify(records[0])).not.toContain("secret-");
  });

  it("脱敏 Error message 中的 Bearer 与密钥赋值", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: (record) => records.push(record),
    });

    logger.error("请求异常", {
      error: new Error(
        "Authorization: Bearer secret-token api_key=secret-key",
      ),
    });

    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-key");
    expect(serialized).toContain("[REDACTED]");
  });

  it("统一脱敏 Cookie、JSON、冒号、URL 与超长外部错误", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: (record) => records.push(record),
    });
    const secrets = [
      "cookie-secret",
      "json-secret",
      "colon-secret",
      "user-secret",
      "query-secret",
      "bearer-secret",
      "value-secret",
    ];
    const externalError = [
      "Cookie: session=cookie-secret",
      '{"apiKey":"json-secret"}',
      "token: colon-secret",
      "https://user:user-secret@example.com/path?token=query-secret",
      "Authorization: Bearer bearer-secret",
      "password=value-secret",
      "x".repeat(10_000),
    ].join(" ");

    logger.error(externalError, {
      error: new Error(externalError),
      payload: externalError,
    });

    const serialized = JSON.stringify(records[0]);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized.length).toBeLessThanOrEqual(8_192);
  });

  it("规范化并脱敏复合 token 与 secret 键名变体", () => {
    const secrets = [
      "access-json",
      "access-equal",
      "refresh-colon",
      "client-secret",
      "session-query",
      "userinfo-secret",
    ];
    const value = [
      '{"accessToken":"access-json"}',
      "access_token=access-equal",
      "refreshToken:refresh-colon",
      "client_secret=client-secret",
      "https://example.com/?sessionToken=session-query",
      "https://user:userinfo-secret@example.com/",
    ].join("\n");

    const sanitized = sanitizeSensitiveString(value);

    for (const secret of secrets) {
      expect(sanitized).not.toContain(secret);
    }
    expect(sanitized).toContain("[REDACTED]");
    expect(
      sanitizeSensitiveString(
        `{"accessToken":"${"a".repeat(100_000)}`,
      ).length,
    ).toBeLessThanOrEqual(2_048);
  });
});
