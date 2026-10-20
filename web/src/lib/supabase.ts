import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js"

let client: SupabaseClient | null = null

/** Browser Supabase client, used only for sign-in. Data goes through the Pantrila API. */
export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) {
      throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    }
    client = createClient(url, key, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
    })
  }
  return client
}

const callback = () => `${window.location.origin}/auth/callback`

/** Leaves the page for Google; the browser comes back to /auth/callback signed in. */
export async function signInWithGoogle(): Promise<string | null> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback() },
  })
  return error?.message ?? null
}

/**
 * Adds Google to the signed-in guest, so the same user id (and its pantry, plans, cookbook
 * and chats) carries on as a lasting account. Needs manual linking on in Supabase Auth.
 */
export async function linkGoogle(): Promise<string | null> {
  const { error } = await supabase().auth.linkIdentity({
    provider: "google",
    options: { redirectTo: callback() },
  })
  return error?.message ?? null
}

/** Supabase names the user from Google's profile; email sign-ins have no name. */
export function firstName(user: User | undefined): string | null {
  const meta = user?.user_metadata ?? {}
  const full = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : ""
  return full.trim().split(/\s+/)[0] || null
}
