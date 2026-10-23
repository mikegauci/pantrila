// Server-side errors (rendering, route handlers) to Sentry; off unless the DSN is set.
import * as Sentry from "@sentry/nextjs"

export function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
  })
}

export const onRequestError = Sentry.captureRequestError
