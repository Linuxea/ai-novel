import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqliteTestDatabase } from "../fixtures/database";

describe("临时 SQLite 测试数据库", () => {
  it("提供独立文件数据库并在释放后清理目录", () => {
    const fixture = createSqliteTestDatabase();

    try {
      fixture.client.exec(
        "CREATE TABLE chapters (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
      );
      fixture.client
        .prepare("INSERT INTO chapters (id, title) VALUES (?, ?)")
        .run("chapter-1", "序章");

      expect(
        fixture.client
          .prepare("SELECT title FROM chapters WHERE id = ?")
          .get("chapter-1"),
      ).toEqual({ title: "序章" });
      expect(
        fixture.database.get<{ answer: number }>("SELECT 42 AS answer"),
      ).toEqual({ answer: 42 });
      expect(existsSync(fixture.filePath)).toBe(true);
    } finally {
      fixture.dispose();
    }

    expect(existsSync(fixture.directory)).toBe(false);
  });

  it("重复释放不会再次关闭数据库", () => {
    const fixture = createSqliteTestDatabase();

    fixture.dispose();

    expect(() => fixture.dispose()).not.toThrow();
    expect(existsSync(fixture.directory)).toBe(false);
  });

  it("关闭失败时保留目录并可恢复后重试", () => {
    const fixture = createSqliteTestDatabase();
    const originalClose = fixture.client.close.bind(fixture.client);
    Object.defineProperty(fixture.client, "close", {
      configurable: true,
      value() {
        throw new Error("close failed");
      },
    });

    expect(() => fixture.dispose()).toThrow("close failed");
    expect(existsSync(fixture.directory)).toBe(true);
    Object.defineProperty(fixture.client, "close", {
      configurable: true,
      value: originalClose,
    });

    expect(() => fixture.dispose()).not.toThrow();
    expect(existsSync(fixture.directory)).toBe(false);
  });
});
