import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The share-image route reads its fonts from disk at runtime.
  outputFileTracingIncludes: {
    "/api/og": ["./public/fonts/**/*"],
  },
};

export default nextConfig;
