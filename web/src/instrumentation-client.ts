// Error reports from the browser to Sentry (EU). Off unless NEXT_PUBLIC_SENTRY_DSN is set.
// Errors and a sample of slow page loads only: no Session Replay, no IP or cookies sent
// (dataCollection), and the user is known by their Supabase id alone (auth-provider.tsx).
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
  // No trace headers on API calls: the API's CORS rules allow only its own headers.
  tracePropagationTargets: [],
  dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
