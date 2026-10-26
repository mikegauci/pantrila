import { APP_ID } from "@/lib/app-links"

/**
 * The phone apps' store pages once they are live, from Vercel variables (the landing site reads the
 * same two): `NEXT_PUBLIC_APP_STORE_ID`, the app's Apple ID in App Store Connect (digits), and
 * `NEXT_PUBLIC_PLAY_STORE_LIVE=1` once the Play listing is public. Unset, the web app does not
 * point to the stores.
 */
const appStoreId = process.env.NEXT_PUBLIC_APP_STORE_ID?.trim()
export const APP_STORE_ID = appStoreId && /^\d+$/.test(appStoreId) ? appStoreId : null
export const APP_STORE_URL = APP_STORE_ID ? `https://apps.apple.com/app/id${APP_STORE_ID}` : null
export const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_LIVE === "1"
  ? `https://play.google.com/store/apps/details?id=${APP_ID}`
  : null
