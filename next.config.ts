import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./next.config.ts"],
  },
};

export default nextConfig;
