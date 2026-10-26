"use client"

import { useRouter } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { useAuth } from "@/components/auth-provider"
import { Logo } from "@/components/logo"
import { takeReturn } from "@/lib/return-to"

const noSubscribe = () => () => {}

const TAKEN =
  "That Google account already has its own Pantrila account. Your guest data stays here; to use the Google account instead, sign out and choose Continue with Google."

const MESSAGES: Record<string, string> = {
  identity_already_exists: TAKEN,
  email_exists: TAKEN,
  manual_linking_disabled: "Adding Google to a guest account is not switched on yet.",
}

function urlError(): string | null {
  const { search, hash } = window.location
  const params = new URLSearchParams(`${search}&${hash.slice(1)}`)
  const code = params.get("error_code")
  return (code && MESSAGES[code]) || params.get("error_description")
}

/** Sign-in links and Google land here; the Supabase client exchanges the code in the URL itself. */
export default function AuthCallback() {
  const router = useRouter()
  const { session, ready } = useAuth()
  const error = useSyncExternalStore(noSubscribe, urlError, () => null)

  // A failed Google link leaves the guest signed in, so only move on when nothing failed.
  useEffect(() => {
    if (ready && session && !error) router.replace(takeReturn())
  }, [ready, session, error, router])

  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-md">
        <Logo className="mb-6 justify-center" />
        {error ? (
          <>
            <p className="font-semibold text-danger">Sign-in failed: {error}</p>
            <a href={session ? "/profile" : "/login"} className="mt-2 inline-block text-primary-text underline">
              {session ? "Back to Pantrila" : "Try again"}
            </a>
          </>
        ) : (
          <p className="text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </main>
  )
}
