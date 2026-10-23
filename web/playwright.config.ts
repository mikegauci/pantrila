import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  // Every test mocks its own API, so spec files can share the one server in parallel.
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: {
    command: process.env.PLAYWRIGHT_DEV
      ? "npm run dev -- --hostname 127.0.0.1 --port 3100"
      : "npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
    timeout: 180_000,
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000",
      // A fake project: reports go to /monitoring, which specs intercept.
      NEXT_PUBLIC_SENTRY_DSN: "https://public@o1.ingest.de.sentry.io/1",
    },
  },
})
