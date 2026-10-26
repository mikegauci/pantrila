// Addresses the landing site links to, kept in one place.
export const SITE_URL = "https://pantrila.com"
export const APP_URL = "https://app.pantrila.com"
export const GITHUB_URL = "https://github.com/mikegauci/pantrila"
export const CONTACT_EMAIL = "hello@pantrila.com"

// The phone apps' store pages, once they are live: set on Vercel (both projects) and redeploy. Unset,
// the store cards say "Coming soon". The App Store id is the app's Apple ID in App Store Connect
// (App Information), digits only; Google Play's page is always the package's.
const APP_STORE_ID = process.env.NEXT_PUBLIC_APP_STORE_ID?.trim()
export const APP_STORE_URL = APP_STORE_ID && /^\d+$/.test(APP_STORE_ID) ? `https://apps.apple.com/app/id${APP_STORE_ID}` : null
export const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_LIVE === "1"
  ? "https://play.google.com/store/apps/details?id=com.pantrila.app"
  : null

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}
