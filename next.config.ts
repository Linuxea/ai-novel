import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
    instrumentation: ["./drizzle/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": ["./next.config.ts"],
  },
};

export default nextConfig;
