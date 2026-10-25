import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { AppState } from "react-native"

import { LargeSecureStore } from "@/lib/secure-session"

let client: SupabaseClient | null = null

/** False in a build made without the Supabase variables: the app then explains instead of crashing. */
export const supabaseReady = () =>
  Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)

/** The phone's Supabase client, used only for sign-in; data goes through the Pantrila API. The
 * session is kept encrypted on the phone (LargeSecureStore) and refreshed only in the foreground. */
export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL
    const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) throw new Error("Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    client = createClient(url, key, {
      auth: {
        storage: new LargeSecureStore(),
        flowType: "pkce",  // email links come back as pantrila://auth/callback?code=...
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
    // A phone app is paused in the background: refresh tokens only while it is on screen.
    AppState.addEventListener("change", (state) => {
      if (state === "active") client?.auth.startAutoRefresh()
      else client?.auth.stopAutoRefresh()
    })
  }
  return client
}

/** The signed-in user's access token for the Pantrila API, or null. */
export async function accessToken(): Promise<string | null> {
  if (!supabaseReady()) return null
  return (await supabase().auth.getSession()).data.session?.access_token ?? null
}
