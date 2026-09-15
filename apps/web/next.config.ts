import type { NextConfig } from "next";

const hostedPoolPreviewEnabled =
  process.env.REVIEW_ROUTER_ENABLE_HOSTED_POOL_PREVIEW === "1";

const jsExtensionAlias = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
} as const;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  serverExternalPackages: ["@777genius/subscription-runtime"],
  transpilePackages: [
    "@reviewrouter/ui",
    "@reviewrouter/platform-db",
    "@reviewrouter/platform-config",
    "@reviewrouter/features-auth",
  ],
  experimental: {
    // Workspace packages use TypeScript ESM `.js` specifiers. Webpack needs
    // this alias so gated preview routes can compile without a prior `tsc`
    // build of every local package.
    extensionAlias: jsExtensionAlias,
  },
  webpack: (config, { webpack }) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ...jsExtensionAlias,
    };
    if (hostedPoolPreviewEnabled) {
      // Preview QA does not need hosted production-readiness startup checks,
      // and bundling `@reviewrouter/platform-config` pulls `node:crypto` into
      // the instrumentation compile.
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /@reviewrouter\/platform-config/,
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
