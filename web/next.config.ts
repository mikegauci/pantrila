import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// Recipe photos come from the project's public Supabase Storage bucket; the host is read from
// the same variable the app signs in with, so no URL is written here.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const photoPatterns = supabaseUrl
  ? [new URL("/storage/v1/object/public/recipe-photos/**", supabaseUrl)]
  : [];

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: photoPatterns,
    // Photo paths change whenever the photo does, so a long cache is safe.
    minimumCacheTTL: 2678400,
  },
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

// Source maps go to Sentry only when SENTRY_AUTH_TOKEN is set (Vercel builds); reports go through
// /monitoring on our own domain so content blockers do not drop them.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sentryUrl: "https://de.sentry.io/",
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
