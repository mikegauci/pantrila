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

export default nextConfig;
