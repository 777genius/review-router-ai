import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  // Retain only the active dev page in the isolated Skills E2E runner.
  ...(process.env.REVIEW_ROUTER_SKILLS_E2E === "1"
    ? { onDemandEntries: { pagesBufferLength: 1 } }
    : {}),
  // Server Function arguments include transient API keys and OAuth codes.
  // Keep request/error diagnostics without printing those arguments in dev.
  logging: { serverFunctions: false },
  serverExternalPackages: ["@777genius/subscription-runtime"],
  transpilePackages: [
    "@reviewrouter/ui",
    "@reviewrouter/features-review-statistics",
    "@reviewrouter/features-review-history",
    "@reviewrouter/features-hosted-account-pool",
  ],
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
