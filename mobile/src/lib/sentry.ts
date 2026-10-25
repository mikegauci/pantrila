import * as Sentry from "@sentry/react-native"

/**
 * Error reports and "Send feedback" through Sentry (EU), as on the web. Off unless
 * `EXPO_PUBLIC_SENTRY_DSN` is set. No personal data: no IP address or request bodies
 * (`sendDefaultPii` off), no trace headers on API calls, and the user is known by their Supabase
 * id alone (`identify`).
 */
export const FEEDBACK_EMAIL = "hello@pantrila.com"
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN

export const sentryReady = () => Boolean(dsn)

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: __DEV__ ? "development" : "production",
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  tracePropagationTargets: [],
})

export const wrapRoot = Sentry.wrap

/** Who later reports belong to: the user id only, or nobody after sign-out. */
export function identify(userId: string | null) {
  Sentry.setUser(userId ? { id: userId } : null)
}

/** Send feedback with the screen it came from; false if it could not be sent. */
export async function sendFeedback(message: string, email: string | undefined, screen: string): Promise<boolean> {
  Sentry.captureFeedback({ message, email, url: `pantrila://${screen.replace(/^\//, "")}` })
  return Sentry.flush()
}
