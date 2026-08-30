import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url:
      process.env.DATABASE_PATH?.trim() ||
      "data/ai-novel.sqlite",
  },
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/platform/database/schema.ts",
});
