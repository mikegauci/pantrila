"use client"

import { useRouter } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { useAuth } from "@/components/auth-provider"
import { Logo } from "@/components/logo"

const noSubscribe = () => () => {}

function urlError(): string | null {
  const { search, hash } = window.location
  return new URLSearchParams(`${search}&${hash.slice(1)}`).get("error_description")
}

/** The sign-in link lands here; the Supabase client exchanges the code in the URL itself. */
export default function AuthCallback() {
  const router = useRouter()
  const { session, ready } = useAuth()
  const error = useSyncExternalStore(noSubscribe, urlError, () => null)

  useEffect(() => {
    if (ready && session) router.replace("/")
  }, [ready, session, router])

  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <Logo className="mb-6 justify-center" />
        {error ? (
          <>
            <p className="font-semibold text-danger">Sign-in failed: {error}</p>
            <a href="/login" className="mt-2 inline-block text-primary-text underline">Try again</a>
          </>
        ) : (
          <p className="text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </main>
  )
}
