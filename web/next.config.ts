import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The signed-in app is client-rendered; validate only segments that opt in with `instant`.
  experimental: { instantInsights: { validationLevel: "manual-warning" } },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
